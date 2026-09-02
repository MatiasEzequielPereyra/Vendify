import { createCashController } from "../cash/cash-controller.js";
import {
  closeCashRegister,
  createCashRegister,
  getCashState,
  listCashHistory,
  listCashRegisters,
  listOpenCashMovements,
  openCashRegister,
  registerCashMovement,
  setCashRegisterActive
} from "../cash/cash-service.js";

export interface VendifyCashV232Api {
  readonly createController: typeof createCashController;
  readonly listRegisters: typeof listCashRegisters;
  readonly getState: typeof getCashState;
  readonly open: typeof openCashRegister;
  readonly registerMovement: typeof registerCashMovement;
  readonly listOpenMovements: typeof listOpenCashMovements;
  readonly close: typeof closeCashRegister;
  readonly listHistory: typeof listCashHistory;
  readonly createRegister: typeof createCashRegister;
  readonly setRegisterActive: typeof setCashRegisterActive;
}

declare global {
  interface Window {
    VendifyCashV232?: VendifyCashV232Api;
  }
}

window.VendifyCashV232 = Object.freeze({
  createController: createCashController,
  listRegisters: listCashRegisters,
  getState: getCashState,
  open: openCashRegister,
  registerMovement: registerCashMovement,
  listOpenMovements: listOpenCashMovements,
  close: closeCashRegister,
  listHistory: listCashHistory,
  createRegister: createCashRegister,
  setRegisterActive: setCashRegisterActive
});
