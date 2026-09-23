import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { daniDexHomeHead } from "../lib/site-metadata";

export const Route = createFileRoute("/")({
  head: daniDexHomeHead,
  component: LandingPage,
});
