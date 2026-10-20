import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!("document" in globalThis)) {
  GlobalRegistrator.register({ url: "http://localhost/" });
}
