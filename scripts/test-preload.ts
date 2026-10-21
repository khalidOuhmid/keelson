import { GlobalRegistrator } from "@happy-dom/global-registrator";

const runtimeFetch = globalThis.fetch;

if (!("document" in globalThis)) {
  GlobalRegistrator.register({ url: "http://localhost/" });
  // happy-dom remplace fetch par une implémentation qui applique la Same Origin Policy ;
  // les tests du serveur appellent 127.0.0.1 et doivent garder le fetch du runtime.
  globalThis.fetch = runtimeFetch;
}
