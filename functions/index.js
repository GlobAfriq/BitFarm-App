const adminApp = require('firebase-admin');
adminApp.initializeApp();

const { buyMachine, sellFraction, buyFraction } = require('./src/machines');
const { submitDepositProof, requestWithdrawal } = require('./src/wallet');
const { doSpin } = require('./src/spin');
const { recordDailyLogin } = require('./src/streak');
const { processWeeklyPayouts } = require('./src/jobs/weeklyPayouts');
const { receiveMpesaSMS, mpesaC2BValidation, mpesaC2BConfirmation, nowpaymentsCallback } = require('./src/webhooks');
const admin = require('./src/admin');

module.exports = { 
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
  ...admin 
};