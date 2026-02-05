export interface AddressInfo {
  address: string;
  balance: number;
  balanceFormatted: string;
}

export interface BalanceData {
  btcBalance: number;
  btcBalanceFormatted: string;
  usdBalance: number;
  usdBalanceFormatted: string;
  plnBalance: number;
  plnBalanceFormatted: string;
  lastUpdated: string;
}

export interface XPUBValidation {
  isValid: boolean;
  error?: string;
}

export interface ElectrumXBalance {
  total_received: number;
  total_sent: number;
  balance: number;
}

export interface KrakenPrice {
  pair: string;
  price: number;
  timestamp: number;
}

export interface AppError {
  error: string;
  message: string;
}