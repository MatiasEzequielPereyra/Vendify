type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type UserId = Brand<string, "UserId">;
export type BusinessId = Brand<string, "BusinessId">;
export type BranchId = Brand<string, "BranchId">;
export type CashRegisterId = Brand<string, "CashRegisterId">;
export type ProductId = Brand<string, "ProductId">;
export type RequestId = Brand<string, "RequestId">;
