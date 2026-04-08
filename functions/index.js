const adminApp = require('firebase-admin');
adminApp.initializeApp();

const { buyMachine, sellFraction, buyFraction } = require('./src/machines');
const { initiateDeposit, requestWithdrawal } = require('./src/wallet');
const { doSpin } = require('./src/spin');
const { recordDailyLogin } = require('./src/streak');
const { processWeeklyPayouts } = require('./src/jobs/weeklyPayouts');
const { mpesaC2BValidation, mpesaC2BConfirmation, nowpaymentsCallback } = require('./src/webhooks');
const admin = require('./src/admin');

module.exports = { 
  buyMachine, 
  sellFraction, 
  buyFraction, 
  initiateDeposit,
  requestWithdrawal, 
  doSpin, 
  recordDailyLogin, 
  processWeeklyPayouts,
  mpesaC2BValidation,
  mpesaC2BConfirmation, 
  nowpaymentsCallback, 
  ...admin 
};