export const minimumSpeechPythonVersion = { major: 3, minor: 11 } as const;

export type SpeechPythonCandidateSource = "discovered" | "test-override";

export interface SpeechPythonCandidate {
  readonly args: readonly string[];
  readonly argv0: string;
  readonly source: SpeechPythonCandidateSource;
}

export interface SpeechPythonVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly value: string;
}

export class SpeechPythonVersionError extends Error {
  readonly code: "SPEECH_PYTHON_INVALID" | "SPEECH_PYTHON_UNSUPPORTED";

  constructor(code: SpeechPythonVersionError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "SpeechPythonVersionError";
  }
}

export const speechPythonCandidates = (
  platform = process.platform,
  testOverride?: string
): readonly SpeechPythonCandidate[] => {
  if (testOverride) {
    return [{ args: [], argv0: testOverride, source: "test-override" }];
  }
  return [
    { args: [], argv0: "python3", source: "discovered" },
    { args: [], argv0: "python", source: "discovered" },
    ...(platform === "win32"
      ? [{ args: ["-3"] as const, argv0: "py", source: "discovered" as const }]
      : [])
  ];
};

export const parseSpeechPythonVersion = (version: string): SpeechPythonVersion => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new SpeechPythonVersionError("SPEECH_PYTHON_INVALID", "Python interpreter returned invalid version evidence");
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major < minimumSpeechPythonVersion.major || (major === minimumSpeechPythonVersion.major && minor < minimumSpeechPythonVersion.minor)) {
    throw new SpeechPythonVersionError(
      "SPEECH_PYTHON_UNSUPPORTED",
      `Python ${version} is unsupported; speech workers require Python >= ${minimumSpeechPythonVersion.major}.${minimumSpeechPythonVersion.minor}`
    );
  }
  return { major, minor, patch, value: version };
};
