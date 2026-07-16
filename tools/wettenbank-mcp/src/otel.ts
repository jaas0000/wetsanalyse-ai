/**
 * OpenTelemetry-instrumentatie voor de Wettenbank MCP-server (HTTP-modus).
 *
 * Gated op `OTEL_EXPORTER_OTLP_ENDPOINT`: zonder endpoint gebeurt er niets (geen SDK-lading, geen
 * overhead). Met endpoint start een `NodeSDK` die inkomende `/mcp`-requests (`instrumentation-http`)
 * en uitgaande SRU-/repository-fetches (`instrumentation-undici`, Node's global fetch) traced en
 * metrics exporteert. De service-naam komt uit `OTEL_SERVICE_NAME` (default `wettenbank-mcp`);
 * endpoint/protocol/resource-attributes leest de SDK zelf uit de standaard OTEL_*-env-vars.
 *
 * Alleen relevant voor het HTTP-transport (de langlevende container). Het stdio-pad raakt dit niet.
 * De SDK-pakketten worden dynamisch geïmporteerd zodat ze pas laden als er echt getraced wordt.
 */

import { metrics, type Counter } from "@opentelemetry/api";
import { log } from "./logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sdk: any = null;

/** Start de OTel-SDK (idempotent). No-op zonder OTEL_EXPORTER_OTLP_ENDPOINT. */
export async function startOtel(): Promise<void> {
  if (_sdk || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  if (!process.env.OTEL_SERVICE_NAME) process.env.OTEL_SERVICE_NAME = "wettenbank-mcp";
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
    const { HttpInstrumentation } = await import("@opentelemetry/instrumentation-http");
    const { UndiciInstrumentation } = await import("@opentelemetry/instrumentation-undici");
    _sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
      instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
    });
    _sdk.start();
    log("info", "functioneel", "OpenTelemetry actief", {
      otel_endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
  } catch (e) {
    _sdk = null;
    log("warn", "functioneel", "OpenTelemetry-setup mislukt (genegeerd)", {
      fout: (e as Error).message,
    });
  }
}

/** Flush + sluit de SDK bij een nette shutdown. Veilig als OTel niet actief is. */
export async function stopOtel(): Promise<void> {
  if (!_sdk) return;
  try {
    await _sdk.shutdown();
  } catch {
    /* nooit laten omvallen op een shutdown-fout */
  }
}

let _cacheTeller: Counter | undefined;

/** Tel een cache-toegang (hit/miss) van de wetstekst-cache. No-op zonder actieve meter-provider. */
export function telCacheToegang(hit: boolean): void {
  try {
    if (!_cacheTeller) {
      _cacheTeller = metrics
        .getMeter("wettenbank-mcp")
        .createCounter("wettenbank.cache.toegang", {
          description: "Cache-toegang (hit/miss) van de wetstekst-cache",
        });
    }
    _cacheTeller.add(1, { resultaat: hit ? "hit" : "miss" });
  } catch {
    /* metrics mogen de request nooit breken */
  }
}
