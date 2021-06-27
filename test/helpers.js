module.exports.expect = require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .expect;

module.exports.random32 = (x = 32) => {
  return web3.utils.randomHex(x);
};

module.exports.random32bn = (x = 32) => {
  return this.bn(this.random32(x));
};

module.exports.randombnBetween = (min, max) => {
  return this.bn(Math.floor(Math.random() * max) + min);
};

module.exports.bn = (number) => {
  return web3.utils.toBN(number);
};

module.exports.toBytes32 = (number) => {
  return web3.utils.toTwosComplement(number);
};
