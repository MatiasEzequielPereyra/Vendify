import { createDiscountController } from "../sales/discount-controller.js";
import { createPosController } from "../sales/pos-controller.js";
import { createSalesHistoryController } from "../sales/sales-history-controller.js";
import {
  calculateSaleTotals,
  discountAuthorizationMatches,
  netSaleTotal,
  normalizeDiscountRequest,
  normalizeSalePayments,
  salePaymentsText,
  salesDateRange,
  saleStatusLabel,
  ticketNumber
} from "../sales/sales-model.js";
import {
  authorizeDiscount,
  configureDiscountPin,
  getDiscountPinState,
  listSales,
  registerLegacySale,
  registerSale,
  returnSaleItems,
  voidSale
} from "../sales/sales-service.js";

export interface VendifySalesV232Api {
  readonly createDiscountController: typeof createDiscountController;
  readonly createPosController: typeof createPosController;
  readonly createHistoryController: typeof createSalesHistoryController;
  readonly normalizeDiscountRequest: typeof normalizeDiscountRequest;
  readonly authorizationMatches: typeof discountAuthorizationMatches;
  readonly calculateTotals: typeof calculateSaleTotals;
  readonly normalizePayments: typeof normalizeSalePayments;
  readonly statusLabel: typeof saleStatusLabel;
  readonly netTotal: typeof netSaleTotal;
  readonly paymentsText: typeof salePaymentsText;
  readonly ticketNumber: typeof ticketNumber;
  readonly dateRange: typeof salesDateRange;
  readonly registerLegacySale: typeof registerLegacySale;
  readonly registerSale: typeof registerSale;
  readonly authorizeDiscount: typeof authorizeDiscount;
  readonly getDiscountPinState: typeof getDiscountPinState;
  readonly configureDiscountPin: typeof configureDiscountPin;
  readonly voidSale: typeof voidSale;
  readonly returnSaleItems: typeof returnSaleItems;
  readonly listSales: typeof listSales;
}

declare global {
  interface Window { VendifySalesV232?: VendifySalesV232Api; }
}

window.VendifySalesV232 = Object.freeze({
  createDiscountController,
  createPosController,
  createHistoryController: createSalesHistoryController,
  normalizeDiscountRequest,
  authorizationMatches: discountAuthorizationMatches,
  calculateTotals: calculateSaleTotals,
  normalizePayments: normalizeSalePayments,
  statusLabel: saleStatusLabel,
  netTotal: netSaleTotal,
  paymentsText: salePaymentsText,
  ticketNumber,
  dateRange: salesDateRange,
  registerLegacySale,
  registerSale,
  authorizeDiscount,
  getDiscountPinState,
  configureDiscountPin,
  voidSale,
  returnSaleItems,
  listSales
});
