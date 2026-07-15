import { ArtifactRegistry } from "@fairy/artifacts";
import { deriveLabels, type RoutingHints } from "@fairy/model-gateway";
import type { EventEnvelope, Labels } from "@fairy/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SpeechArtifactValidationError, validateSpeechWorkerArtifact } from "./speech-artifact.js";
import {
  SpeechInputArtifactValidationError,
  stageSpeechInputArtifact,
  validateSpeechInputArtifact
} from "./speech-input-artifact.js";
import {
  governanceForSpeech,
  predictedMimoAsrRequestBytes,
  speechAsrProviderEgress,
  speechProviderClearance,
  speechProviderEgress,
  type MimoAsrProviderConfig,
  type MiniMaxTtsProviderConfig,
  type SpeechProviderRuntimeConfig
} from "./speech-provider.js";
import {
  mimoAsrWorkerDeadlines,
  SpeechWorkerProcess,
  SpeechWorkerProcessError,
  speechProviderWorkerDeadlines,
  type SpeechProviderWorkerTestMode,
  type SpeechWorkerReadyInfo
} from "./speech-worker-process.js";

export interface SpeechProviderCoordinatorTestOptions {
  readonly speechProviderLoopbackPorts?: Readonly<Record<string, number>>;
  readonly speechProviderRequestDeadlineMs?: Readonly<Record<string, number>>;
  readonly speechProviderTempPrefix?: string;
  readonly speechProviderWorkerModes?: Readonly<Record<string, SpeechProviderWorkerTestMode>>;
}

export interface SpeechProviderProgressInput {
  readonly detail: string;
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly labels: Labels;
  readonly stage: string;
}

export type SpeechProviderProgressEmitter = (input: SpeechProviderProgressInput) => Promise<EventEnvelope>;

export interface ProviderTtsEvidence {
  readonly artifactId?: string;
  readonly artifactRef?: string;
  readonly byteCount?: number;
  readonly events: readonly EventEnvelope[];
  readonly providerRequestCount: number;
  readonly route: readonly string[];
  readonly selectedProvider?: MiniMaxTtsProviderConfig;
  readonly sha256?: string;
  readonly status: string;
  readonly successChecks?: {
    readonly base_resp_status_zero: true;
    readonly data_status_complete: true;
  };
  readonly worker?: SpeechWorkerReadyInfo;
}

export interface ProviderAsrEvidence {
  readonly audioRef: string;
  readonly cancelled: boolean;
  readonly effectiveLabels: Labels;
  readonly errorCategory: string;
  readonly events: readonly EventEnvelope[];
  readonly providerConnectionCount: number;
  readonly providerRequestCount: number;
  readonly retryable: boolean;
  readonly route: readonly string[];
  readonly selectedProvider?: MimoAsrProviderConfig;
  readonly stagedBytes: number;
  readonly status: string;
  readonly transcriptText?: string;
  readonly usageSeconds?: number;
  readonly providerEvidence?: {
    readonly finishReason?: "stop";
    readonly model?: "mimo-v2.5-asr";
    readonly requestId?: string;
  };
  readonly worker?: SpeechWorkerReadyInfo;
  readonly workerSpawnCount: number;
}

export interface SpeechProviderCoordinatorOptions {
  readonly artifactsDir: string;
  readonly config: Record<string, unknown>;
  readonly ownerLiveAsrProviderEnabled: boolean;
  readonly ownerLiveSpeechProviderEnabled: boolean;
  readonly providers: SpeechProviderRuntimeConfig;
  readonly resolveMimoAsrCredential: (provider: MimoAsrProviderConfig) => string;
  readonly resolveSpeechProviderCredential: (provider: MiniMaxTtsProviderConfig) => string;
  readonly testOptions?: SpeechProviderCoordinatorTestOptions;
}

const labelsCover = (stored: Labels, required: Labels): boolean => {
  const joined = deriveLabels([{ labels: stored }, { labels: required }], stored);
  return joined.sensitivity === stored.sensitivity && joined.residency === stored.residency;
};

const ttsStatus = (error: unknown): string => {
  if (error instanceof SpeechWorkerProcessError || error instanceof SpeechArtifactValidationError) {
    return error.code;
  }
  return "SPEECH_TTS_FAILED";
};

const asrCategory = (error: unknown): { readonly category: string; readonly retryable: boolean } => {
  if (error instanceof SpeechWorkerProcessError) {
    const workerCategory = error.code.match(/^SPEECH_WORKER_(INVALID_REQUEST|UNAUTHORIZED|BALANCE_EXHAUSTED|ACCESS_DENIED|ENDPOINT_OR_MODEL|SAFETY_BLOCKED|RATE_LIMITED|PROVIDER_TRANSIENT|PROVIDER_UNAVAILABLE|TRANSPORT_FAILURE|TIMEOUT|PROVIDER_PROTOCOL)$/)?.[1];
    if (workerCategory) {
      return { category: workerCategory.toLowerCase(), retryable: error.retryable };
    }
    if (error.code.includes("TIMEOUT")) {
      return { category: "timeout", retryable: true };
    }
    return { category: "provider_protocol", retryable: error.retryable };
  }
  if (error instanceof SpeechInputArtifactValidationError) {
    return { category: "invalid_request", retryable: false };
  }
  return { category: "invalid_request", retryable: false };
};

const isTestRuntime = (): boolean => process.env.NODE_ENV === "test" || process.env.CI === "true";

export class SpeechProviderCoordinator {
  readonly #options: SpeechProviderCoordinatorOptions;
  readonly #activeAsr = new Map<string, { cancelled: boolean; worker: SpeechWorkerProcess }>();
  readonly #workers = new Set<SpeechWorkerProcess>();

  constructor(options: SpeechProviderCoordinatorOptions) {
    const testOptions = options.testOptions ?? {};
    const hasTestSeam = Boolean(testOptions.speechProviderLoopbackPorts || testOptions.speechProviderRequestDeadlineMs || testOptions.speechProviderTempPrefix || testOptions.speechProviderWorkerModes);
    if (hasTestSeam && !isTestRuntime()) {
      throw new Error("speech provider test seams are available only to code-gated tests");
    }
    if (testOptions.speechProviderTempPrefix !== undefined && !/^fairy-[a-z0-9-]{1,40}-$/.test(testOptions.speechProviderTempPrefix)) {
      throw new Error("speech provider test temp prefix must be a bounded repository-owned token");
    }
    for (const [providerId, port] of Object.entries(testOptions.speechProviderLoopbackPorts ?? {})) {
      if (!providerId || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("speech provider test loopback ports must be keyed by provider id and use valid ports");
      }
    }
    for (const [providerId, deadline] of Object.entries(testOptions.speechProviderRequestDeadlineMs ?? {})) {
      const ceiling = options.providers.providers.find((provider) => provider.id === providerId)?.stage === "asr"
        ? mimoAsrWorkerDeadlines.requestMs
        : speechProviderWorkerDeadlines.requestMs;
      if (!providerId || !Number.isInteger(deadline) || deadline < 100 || deadline > ceiling) {
        throw new Error("speech provider test request deadlines must be bounded positive integers");
      }
    }
    this.#options = options;
  }

  async shutdown(): Promise<void> {
    for (const operation of this.#activeAsr.values()) {
      operation.cancelled = true;
    }
    await Promise.allSettled([...this.#workers].map((worker) => worker.terminateForTest("speech provider coordinator shutdown")));
    this.#activeAsr.clear();
    this.#workers.clear();
  }

  async cancelAsr(operationId: string): Promise<boolean> {
    const operation = this.#activeAsr.get(operationId);
    if (!operation) {
      return false;
    }
    operation.cancelled = true;
    await operation.worker.terminateForTest("provider ASR cancelled").catch(() => undefined);
    return true;
  }

  async runTts(input: {
    readonly candidateLimit?: number;
    readonly emitProgress: SpeechProviderProgressEmitter;
    readonly labels: Labels;
    readonly routingHints?: RoutingHints;
    readonly text: string;
    readonly utteranceId: string;
  }): Promise<ProviderTtsEvidence> {
    const events: EventEnvelope[] = [];
    const route: string[] = [];
    let providerRequestCount = 0;
    let lastStatus = "no_eligible_provider";
    const candidates = input.candidateLimit === undefined
      ? this.#options.providers.ttsCandidates
      : this.#options.providers.ttsCandidates.slice(0, Math.max(0, input.candidateLimit));
    const emitProgress = async (stage: string, detail: string, extra: Record<string, unknown> = {}): Promise<void> => {
      events.push(await input.emitProgress({ detail, extra, labels: input.labels, stage }));
    };

    if (candidates.length === 0) {
      return { events, providerRequestCount, route, status: "not_configured" };
    }
    const configuredTextLimit = candidates[0]?.limits.maxTextChars ?? 3_000;
    if (input.text.length < 1 || input.text.length > configuredTextLimit) {
      await emitProgress("voice.tts.rejected", "TTS text was empty or exceeded the configured non-streaming limit.", { error_code: "tts_text_invalid" });
      return { events, providerRequestCount, route, status: "tts_text_invalid" };
    }
    const egress = speechProviderEgress(input.text, input.labels);
    if (!egress.ok) {
      await emitProgress("voice.tts.egress-denied", "TTS egress was denied before provider I/O.", {
        error_code: "tts_egress_denied",
        reason_code: egress.reasonCode
      });
      return { events, providerRequestCount, route, status: "tts_egress_denied" };
    }

    const governance = governanceForSpeech(this.#options.config);
    for (const provider of candidates) {
      const clearance = speechProviderClearance(input.labels, provider, governance, input.routingHints ?? {});
      if (!clearance.ok) {
        route.push(`${provider.id}:denied`);
        await emitProgress("voice.tts.route-denied", "TTS candidate was denied by data clearance before worker/provider I/O.", {
          candidate_id: provider.id,
          reason: clearance.reason ?? "provider clearance did not satisfy visible-text labels"
        });
        continue;
      }
      if (input.text.length > provider.limits.maxTextChars) {
        route.push(`${provider.id}:adapter-rejected`);
        await emitProgress("voice.tts.rejected", "TTS text exceeded the selected candidate's non-streaming limit.", {
          candidate_id: provider.id,
          error_code: "tts_text_invalid"
        });
        return { events, providerRequestCount, route, status: "tts_text_invalid" };
      }

      const testLoopbackPort = this.#options.testOptions?.speechProviderLoopbackPorts?.[provider.id];
      if (isTestRuntime() && testLoopbackPort === undefined) {
        route.push(`${provider.id}:test-network-denied`);
        await emitProgress("voice.tts.failed", "Public speech-provider network is forbidden in tests and CI.", {
          candidate_id: provider.id,
          error_code: "tts_public_network_forbidden"
        });
        return { events, providerRequestCount, route, status: "tts_public_network_forbidden" };
      }
      if (testLoopbackPort === undefined && !this.#options.ownerLiveSpeechProviderEnabled) {
        route.push(`${provider.id}:owner-live-required`);
        await emitProgress("voice.tts.failed", "Real speech-provider execution requires explicit owner-live mode.", {
          candidate_id: provider.id,
          error_code: "tts_owner_live_required"
        });
        return { events, providerRequestCount, route, status: "tts_owner_live_required" };
      }

      let credential: string;
      try {
        credential = this.#options.resolveSpeechProviderCredential(provider);
      } catch {
        route.push(`${provider.id}:credential-unavailable`);
        await emitProgress("voice.tts.failed", "The selected TTS credential was unavailable.", {
          candidate_id: provider.id,
          error_code: "tts_credential_unavailable"
        });
        return { events, providerRequestCount, route, status: "tts_credential_unavailable" };
      }

      let outputRoot: string | undefined;
      let worker: SpeechWorkerProcess | undefined;
      let ready: SpeechWorkerReadyInfo | undefined;
      let cleanShutdown = false;
      try {
        outputRoot = await mkdtemp(join(tmpdir(), `${this.#options.testOptions?.speechProviderTempPrefix ?? "fairy-"}minimax-tts-`));
        const testRequestDeadline = this.#options.testOptions?.speechProviderRequestDeadlineMs?.[provider.id];
        worker = new SpeechWorkerProcess({
          ...(testRequestDeadline === undefined ? {} : { deadlines: { requestMs: testRequestDeadline } }),
          provider: {
            credential,
            outputRoot,
            ...(testLoopbackPort === undefined ? {} : { testLoopbackPort }),
            ...(this.#options.testOptions?.speechProviderWorkerModes?.[provider.id]
              ? { testMode: this.#options.testOptions.speechProviderWorkerModes[provider.id] }
              : {})
          }
        });
        this.#workers.add(worker);
        ready = await worker.start();
        providerRequestCount += 1;
        const result = await worker.requestProviderTts({
          labels: input.labels,
          provider,
          requestId: `provider-tts:${input.utteranceId}:${provider.id}`,
          text: input.text,
          utteranceId: input.utteranceId
        });
        const chunk = result.chunks[0];
        if (!chunk || result.chunks.length !== 1) {
          throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_RESULT_INVALID", "provider worker did not return exactly one artifact-backed TTS chunk");
        }
        const validated = await validateSpeechWorkerArtifact(outputRoot, chunk, provider.limits.maxAudioBytes);
        await worker.shutdown();
        cleanShutdown = true;
        this.#workers.delete(worker);
        await rm(outputRoot, { force: true, recursive: true });
        outputRoot = undefined;

        const registered = await new ArtifactRegistry(this.#options.artifactsDir).register({
          content: validated.bytes,
          kind: "speech",
          labels: input.labels,
          metadata: { audio_format: "mp3" },
          mime: "audio/mpeg",
          origin: "speech:tts",
          sourceFilename: "speech.mp3"
        });
        if (
          registered.record.kind !== "speech" ||
          registered.record.mime !== "audio/mpeg" ||
          registered.record.hash !== validated.sha256 ||
          registered.record.size_bytes !== validated.sizeBytes ||
          !labelsCover(registered.record.labels, input.labels)
        ) {
          throw new SpeechArtifactValidationError("SPEECH_ARTIFACT_REGISTRY_MISMATCH", "persistent speech artifact did not preserve validated metadata and labels");
        }
        route.push(`${provider.id}:selected`);
        return {
          artifactId: registered.record.artifact_id,
          artifactRef: registered.record.artifact_id,
          byteCount: registered.record.size_bytes,
          events,
          providerRequestCount,
          route,
          selectedProvider: provider,
          sha256: registered.record.hash,
          status: "none",
          successChecks: { base_resp_status_zero: true, data_status_complete: true },
          ...(ready ? { worker: ready } : {})
        };
      } catch (error) {
        lastStatus = ttsStatus(error);
        route.push(`${provider.id}:failed:${lastStatus}`);
        await emitProgress("voice.tts.failed", "TTS synthesis failed; the completed text turn remains available.", {
          candidate_id: provider.id,
          error_code: lastStatus
        });
        if (!(error instanceof SpeechWorkerProcessError && error.retryable)) {
          return { events, providerRequestCount, route, status: lastStatus, ...(ready ? { worker: ready } : {}) };
        }
      } finally {
        if (worker && !cleanShutdown) {
          await worker.shutdown("provider TTS cleanup").catch(() => worker?.terminateForTest("provider TTS forced cleanup"));
          this.#workers.delete(worker);
        }
        if (outputRoot) {
          await rm(outputRoot, { force: true, recursive: true }).catch(() => undefined);
        }
      }
    }
    return { events, providerRequestCount, route, status: lastStatus };
  }

  async runAsr(input: {
    readonly audioRef: string;
    readonly emitProgress: SpeechProviderProgressEmitter;
    readonly floorLabels: Labels;
    readonly isCancelled: () => boolean;
    readonly operationId: string;
    readonly requestLabels?: Labels;
    readonly routingHints?: RoutingHints;
    readonly utteranceId: string;
  }): Promise<ProviderAsrEvidence> {
    const events: EventEnvelope[] = [];
    const route: string[] = [];
    let effectiveLabels = deriveLabels([
      { labels: input.floorLabels },
      ...(input.requestLabels ? [{ labels: input.requestLabels }] : [])
    ], input.floorLabels);
    let providerConnectionCount = 0;
    let providerRequestCount = 0;
    let stagedBytes = 0;
    let workerSpawnCount = 0;
    const base = () => ({
      audioRef: input.audioRef,
      cancelled: false,
      effectiveLabels,
      events,
      providerConnectionCount,
      providerRequestCount,
      route,
      stagedBytes,
      workerSpawnCount
    });
    const fail = (status: string, errorCategory = status, retryable = false): ProviderAsrEvidence => ({
      ...base(),
      errorCategory,
      retryable,
      status
    });
    const emitProgress = async (stage: string, detail: string, extra: Record<string, unknown> = {}): Promise<void> => {
      events.push(await input.emitProgress({ detail, extra, labels: effectiveLabels, stage }));
    };
    const provider = this.#options.providers.asrCandidates[0];
    if (!provider) {
      return fail("not_configured", "invalid_request");
    }
    const cancelled = async (ready?: SpeechWorkerReadyInfo): Promise<ProviderAsrEvidence> => {
      route.push(`${provider.id}:cancelled`);
      await emitProgress("voice.asr.cancelled", "ASR provider request was cancelled before a final transcript.", {
        candidate_id: provider.id,
        error_code: "cancelled",
        retryable: false
      });
      return {
        ...fail("asr_cancelled", "cancelled"),
        cancelled: true,
        selectedProvider: provider,
        ...(ready ? { worker: ready } : {})
      };
    };

    let artifact: Awaited<ReturnType<typeof validateSpeechInputArtifact>>;
    try {
      artifact = await validateSpeechInputArtifact(new ArtifactRegistry(this.#options.artifactsDir), input.audioRef, provider.limits.maxInputBytes);
      effectiveLabels = deriveLabels([
        { labels: input.floorLabels },
        ...(input.requestLabels ? [{ labels: input.requestLabels }] : []),
        { labels: artifact.record.labels }
      ], input.floorLabels);
    } catch (error) {
      const failure = asrCategory(error);
      await emitProgress("voice.asr.rejected", "ASR input artifact failed bounded validation.", { error_code: failure.category });
      return fail("asr_input_invalid", failure.category, failure.retryable);
    }
    if (input.isCancelled()) {
      return cancelled();
    }

    const clearance = speechProviderClearance(effectiveLabels, provider, governanceForSpeech(this.#options.config), input.routingHints ?? {});
    if (!clearance.ok) {
      route.push(`${provider.id}:denied`);
      await emitProgress("voice.asr.route-denied", "ASR candidate was denied before staging, worker spawn, or provider I/O.", {
        candidate_id: provider.id,
        reason: clearance.reason ?? "provider clearance did not satisfy effective audio labels"
      });
      return fail("asr_route_denied", "invalid_request");
    }
    const egress = speechAsrProviderEgress(input.audioRef, effectiveLabels);
    if (!egress.ok) {
      await emitProgress("voice.asr.egress-denied", "ASR egress was denied before staging, worker spawn, or provider I/O.", {
        error_code: "asr_egress_denied",
        reason_code: egress.reasonCode
      });
      return fail("asr_egress_denied", "invalid_request");
    }
    if (predictedMimoAsrRequestBytes(artifact.sizeBytes, artifact.mime, provider.language) > provider.limits.maxEncodedRequestBytes) {
      route.push(`${provider.id}:adapter-rejected`);
      await emitProgress("voice.asr.rejected", "ASR input exceeded the closed encoded-request limit before provider I/O.", {
        candidate_id: provider.id,
        error_code: "invalid_request"
      });
      return fail("asr_request_too_large", "invalid_request");
    }
    const testLoopbackPort = this.#options.testOptions?.speechProviderLoopbackPorts?.[provider.id];
    if (isTestRuntime() && testLoopbackPort === undefined) {
      route.push(`${provider.id}:test-network-denied`);
      await emitProgress("voice.asr.failed", "Public speech-provider network is forbidden in tests and CI.", {
        candidate_id: provider.id,
        error_code: "asr_public_network_forbidden"
      });
      return fail("asr_public_network_forbidden", "invalid_request");
    }
    if (testLoopbackPort === undefined && !this.#options.ownerLiveAsrProviderEnabled) {
      route.push(`${provider.id}:owner-live-required`);
      await emitProgress("voice.asr.failed", "Real MiMo ASR execution requires explicit owner-live mode.", {
        candidate_id: provider.id,
        error_code: "asr_owner_live_required"
      });
      return fail("asr_owner_live_required", "invalid_request");
    }
    if (input.isCancelled()) {
      return cancelled();
    }

    let credential: string;
    try {
      credential = this.#options.resolveMimoAsrCredential(provider);
    } catch {
      route.push(`${provider.id}:credential-unavailable`);
      await emitProgress("voice.asr.failed", "The selected ASR credential was unavailable or not pay-as-you-go.", {
        candidate_id: provider.id,
        error_code: "asr_credential_unavailable"
      });
      return fail("asr_credential_unavailable", "invalid_request");
    }

    if (this.#activeAsr.has(input.operationId)) {
      route.push(`${provider.id}:failed:provider_protocol`);
      await emitProgress("voice.asr.failed", "One ASR provider operation is already active for this session.", {
        candidate_id: provider.id,
        error_code: "provider_protocol",
        retryable: false
      });
      return fail("asr_failed", "provider_protocol");
    }

    let inputRoot: string | undefined;
    let worker: SpeechWorkerProcess | undefined;
    let ready: SpeechWorkerReadyInfo | undefined;
    let cleanShutdown = false;
    let ownsActive = false;
    let active: { cancelled: boolean; worker: SpeechWorkerProcess } | undefined;
    try {
      inputRoot = await mkdtemp(join(tmpdir(), `${this.#options.testOptions?.speechProviderTempPrefix ?? "fairy-"}mimo-asr-`));
      if (input.isCancelled()) {
        return await cancelled();
      }
      const staged = await stageSpeechInputArtifact(inputRoot, artifact);
      stagedBytes = staged.stagedBytes;
      if (input.isCancelled()) {
        return await cancelled();
      }
      const testRequestDeadline = this.#options.testOptions?.speechProviderRequestDeadlineMs?.[provider.id];
      worker = new SpeechWorkerProcess({
        ...(testRequestDeadline === undefined ? {} : { deadlines: { requestMs: testRequestDeadline } }),
        provider: {
          credential,
          inputRoot,
          kind: "mimo-asr",
          ...(testLoopbackPort === undefined ? {} : { testLoopbackPort }),
          ...(this.#options.testOptions?.speechProviderWorkerModes?.[provider.id]
            ? { testMode: this.#options.testOptions.speechProviderWorkerModes[provider.id] }
            : {})
        }
      });
      this.#workers.add(worker);
      active = { cancelled: false, worker };
      if (this.#activeAsr.has(input.operationId)) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_QUEUE_FULL", "one ASR provider operation is already active for this session");
      }
      this.#activeAsr.set(input.operationId, active);
      ownsActive = true;
      workerSpawnCount = 1;
      ready = await worker.start();
      if (input.isCancelled() || active.cancelled) {
        return await cancelled(ready);
      }
      providerConnectionCount = 1;
      providerRequestCount = 1;
      const result = await worker.requestProviderAsr({
        artifact: {
          audioRef: artifact.audioRef,
          inputToken: staged.token,
          mime: artifact.mime,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes
        },
        provider,
        requestId: `provider-asr:${input.utteranceId}:${provider.id}`,
        utteranceId: input.utteranceId
      });
      if (input.isCancelled() || active.cancelled) {
        return await cancelled(ready);
      }
      if (result.cancelled || !result.text || result.audioRef !== input.audioRef || result.utteranceId !== input.utteranceId) {
        throw new SpeechWorkerProcessError("SPEECH_WORKER_PROVIDER_RESULT_INVALID", "provider worker returned an incomplete or uncorrelated ASR final");
      }
      await worker.shutdown();
      cleanShutdown = true;
      this.#workers.delete(worker);
      await rm(inputRoot, { force: true, recursive: true });
      inputRoot = undefined;
      if (input.isCancelled() || active.cancelled) {
        return await cancelled(ready);
      }
      route.push(`${provider.id}:selected`);
      return {
        ...base(),
        cancelled: false,
        errorCategory: "none",
        providerEvidence: {
          ...(result.providerEvidence?.finishReason ? { finishReason: result.providerEvidence.finishReason } : {}),
          ...(result.providerEvidence?.model ? { model: result.providerEvidence.model } : {}),
          ...(result.providerEvidence?.requestId ? { requestId: result.providerEvidence.requestId } : {})
        },
        retryable: false,
        selectedProvider: provider,
        status: "none",
        transcriptText: result.text,
        ...(result.providerEvidence?.usageSeconds === undefined ? {} : { usageSeconds: result.providerEvidence.usageSeconds }),
        ...(ready ? { worker: ready } : {})
      };
    } catch (error) {
      const wasCancelled = input.isCancelled() || (ownsActive && active?.cancelled === true);
      const failure = asrCategory(error);
      const category = wasCancelled ? "cancelled" : failure.category;
      route.push(`${provider.id}:failed:${category}`);
      await emitProgress(wasCancelled ? "voice.asr.cancelled" : "voice.asr.failed", wasCancelled
        ? "ASR provider request was cancelled before a final transcript."
        : "ASR provider request failed without producing a final transcript.", {
        candidate_id: provider.id,
        error_code: category,
        retryable: wasCancelled ? false : failure.retryable
      });
      return {
        ...fail(wasCancelled ? "asr_cancelled" : "asr_failed", category, wasCancelled ? false : failure.retryable),
        cancelled: wasCancelled,
        selectedProvider: provider,
        ...(ready ? { worker: ready } : {})
      };
    } finally {
      if (ownsActive && this.#activeAsr.get(input.operationId) === active) {
        this.#activeAsr.delete(input.operationId);
      }
      if (worker && !cleanShutdown) {
        await worker.shutdown("provider ASR cleanup").catch(() => worker?.terminateForTest("provider ASR forced cleanup"));
        this.#workers.delete(worker);
      }
      if (inputRoot) {
        await rm(inputRoot, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  }
}
