import {
  createRealtimeController,
  type RealtimeController,
  type RealtimeControllerDependencies
} from "../context/realtime-controller.js";

export interface VendifyRealtimeV232Api {
  readonly createController: (dependencies: RealtimeControllerDependencies) => RealtimeController;
}

declare global {
  interface Window {
    VendifyRealtimeV232?: VendifyRealtimeV232Api;
  }
}

window.VendifyRealtimeV232 = Object.freeze({ createController: createRealtimeController });
