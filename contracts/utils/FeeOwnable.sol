pragma solidity 0.8.0;


contract FeeOwnable {
    // 10000 ==  100%
    //   505 ==    5.05%
    uint256 public constant BASE = 10000;
    // maximum fee rate: 5%
    uint256 public constant MAX_FEE_RATE = 500;
    uint256 public feeOwnerRate;

    address public feeOwner;

    mapping(address => bool) public excludeFromFee;

    event FeeOwnershipTransferred(address indexed previousFeeOwner, address indexed newFeeOwner);
    event SetFeeOwnerRate(uint256 feeOwnerRate);
    event SetExcludeFromFee(address account, bool exclude);

    constructor () {
        feeOwner = msg.sender;
        emit FeeOwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyFeeOwner() {
        require(feeOwner == msg.sender, "FeeOwnable::onlyFeeOwner: caller is not the fee owner");
        _;
    }

    function renounceFeeOwnership() external onlyFeeOwner {
        emit FeeOwnershipTransferred(feeOwner, address(0));
        feeOwner = address(0);
    }

    function transferFeeOwnership(address newFeeOwner) external onlyFeeOwner {
        require(newFeeOwner != address(0), "FeeOwnable::transferOwnership: new owner is the zero address");
        emit FeeOwnershipTransferred(feeOwner, newFeeOwner);
        feeOwner = newFeeOwner;
    }

    function setFeeOwnerRate(uint256 _feeOwnerRate) external onlyFeeOwner {
        require(_feeOwnerRate <= MAX_FEE_RATE, "FeeOwnable::setFeeOwnerRate: The fee rate should be low or equal than MAX_FEE_RATE");

        feeOwnerRate = _feeOwnerRate;

        emit SetFeeOwnerRate(_feeOwnerRate);
    }

    function setExcludeFromFee(address _account, bool _exclude) public onlyFeeOwner {
        excludeFromFee[_account] = _exclude;

        emit SetExcludeFromFee(_account, _exclude);
    }

    function _getRateFeeOwnerAmount(uint256 _amount) internal view returns(uint256) {
        return _getRateAmount(_amount, feeOwnerRate);
    }

    function _getRateAmount(uint256 _amount, uint256 _rate) internal pure returns(uint256) {
        return (_amount * _rate) / BASE;
    }
}
