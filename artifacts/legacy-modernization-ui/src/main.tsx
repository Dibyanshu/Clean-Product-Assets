import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Initialize API client base URL
import { setBaseUrl } from "@workspace/api-client-react";
setBaseUrl(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api");

createRoot(document.getElementById("root")!).render(<App />);
