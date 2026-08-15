import http from "node:http";
import handler from "./api/index.js";

const port = process.env.PORT || 3000;
http
  .createServer((req, res) => handler(req, res))
  .listen(port, () => console.log(`yavot-api local server on http://localhost:${port}`));
