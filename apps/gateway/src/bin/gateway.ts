#!/usr/bin/env node
import { loadGatewayConfig, parseGatewayArgs } from "../config.js";
import { MinimalGateway } from "../server.js";

const main = async (): Promise<void> => {
  const options = parseGatewayArgs(process.argv.slice(2));
  const config = loadGatewayConfig(options);
  const gateway = new MinimalGateway(config);
  const address = await gateway.start();
  console.log(`Fairy gateway listening on http://${address.host}:${address.port}`);
  console.log(`gateway.started ${JSON.stringify({ host: address.host, port: address.port })}`);

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) {
      gateway.abortActiveTurns("gateway_shutdown");
      return;
    }
    stopping = true;
    void gateway
      .stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(`Gateway shutdown failed: ${(error as Error).message}`);
        process.exit(1);
      });
    process.once(signal, shutdown);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

main().catch((error: unknown) => {
  console.error(`Gateway failed to start: ${(error as Error).message}`);
  process.exit(1);
});
