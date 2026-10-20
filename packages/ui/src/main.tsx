import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./styles.css";

const container = document.getElementById("root");

if (container === null) {
  throw new Error("élément #root absent de index.html");
}

createRoot(container).render(<App />);
