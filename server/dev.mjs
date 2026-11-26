import express from "express";
import { createApp } from "./app.mjs";
const app = createApp();
app.use(express.static("dist"));
app.listen(process.env.PORT ?? 3000, () =>
  console.log("VisitaFácil: http://localhost:3000/plataforma.html"),
);
