pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./utils/FeeOwnable.sol";
import "./utils/Governance.sol";


contract PlayToken is Ownable, FeeOwnable, Governance("Play Token", "PLAY") {
    event SetBurnRate(uint256 burnRate);

    uint256 public constant MAX_BURN_RATE = 500;
    uint256 public burnRate;

    constructor () {
        setExcludeFromFee(address(0), true);
        setExcludeFromFee(msg.sender, true);
        setExcludeFromFee(feeOwner, true);
    }

    // ERC20 override

    function _transfer(address _sender, address _recipient, uint256 _amount) internal override {
        uint256 feeAmount;
        uint256 burnAmount;

        if (!(excludeFromFee[_sender] || excludeFromFee[_recipient])) {
            // Burn amount
            if (burnRate != 0) {
                burnAmount = _getRateAmount(_amount, burnRate);
                super._burn(_sender, burnAmount);
            }

            // Take owner amount
            if (feeOwnerRate != 0) {
                feeAmount = _getRateFeeOwnerAmount(_amount);
                super._transfer(_sender, feeOwner, feeAmount);
            }
        }

        // Transfer to recipient
        super._transfer(_sender, _recipient, _amount - burnAmount - feeAmount);
    }

    // Only fee owner

    function setBurnRate(uint256 _burnRate) external onlyFeeOwner {
        require(_burnRate <= MAX_BURN_RATE, "PlayToken::setBurnRate: The fee burn rate should be low or equal than MAX_BURN_RATE");

        burnRate = _burnRate;

        emit SetBurnRate(_burnRate);
    }

    // Only owner

    function mintTo(address _to, uint256 _amount) external onlyOwner {
        _mint(_to, _amount);
        _moveDelegates(address(0), _delegates[_to], uint224(_amount));
    }
}
