import adminApp from "firebase-admin";
adminApp.initializeApp();

import {buyMachine, sellFraction, buyFraction} from "./src/machines.js";
import {submitDepositProof, requestWithdrawal} from "./src/wallet.js";
import {doSpin} from "./src/spin.js";
import {recordDailyLogin} from "./src/streak.js";
import {processWeeklyPayouts} from "./src/jobs/weeklyPayouts.js";
import {
  receiveMpesaSMS,
  mpesaC2BValidation,
  mpesaC2BConfirmation,
  nowpaymentsCallback,
} from "./src/webhooks.js";
export {
  buyMachine,
  sellFraction,
  buyFraction,
  submitDepositProof,
  requestWithdrawal,
  doSpin,
  recordDailyLogin,
  processWeeklyPayouts,
  receiveMpesaSMS,
  mpesaC2BValidation,
  mpesaC2BConfirmation,
  nowpaymentsCallback,
};
export * from "./src/admin.js";
