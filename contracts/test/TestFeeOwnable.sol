pragma solidity 0.8.0;

import "../utils/FeeOwnable.sol";


contract TestFeeOwnable is FeeOwnable {
    function testOnlyFeeOwner() external onlyFeeOwner { }

    function getRateFeeOwnerAmount(uint256 _amount) external view returns(uint256) {
        return _getRateFeeOwnerAmount(_amount);
    }

    function getRateAmount(uint256 _amount, uint256 _rate) external pure returns(uint256) {
        return _getRateAmount(_amount, _rate);
    }
}
