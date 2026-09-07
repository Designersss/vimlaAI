import { makeAutoObservable } from "mobx";
import type { HealthResponse } from "@vimla/contracts";

export type HealthViewState = "idle" | "loading" | "ready" | "failed";

export class HealthStore {
  state: HealthViewState = "idle";
  health: HealthResponse | null = null;
  errorMessage: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  startLoading(): void {
    this.state = "loading";
    this.errorMessage = null;
  }

  succeed(health: HealthResponse): void {
    this.health = health;
    this.state = "ready";
    this.errorMessage = null;
  }

  fail(message: string): void {
    this.state = "failed";
    this.errorMessage = message;
  }
}
