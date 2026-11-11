import { GlobalRegistrator } from "@happy-dom/global-registrator";

const runtimeFetch = globalThis.fetch;

if (!("document" in globalThis)) {
  GlobalRegistrator.register({ url: "http://localhost/" });
  // happy-dom replaces fetch with an implementation that enforces the Same Origin Policy;
  // the server tests call 127.0.0.1 and must keep the runtime's fetch.
  globalThis.fetch = runtimeFetch;
}
