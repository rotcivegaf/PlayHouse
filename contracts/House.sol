pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./PlayToken.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IBetOracle.sol";


contract House is FeeOwnable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Address for address;

    event Create(
        IERC20 indexed erc20,
        address indexed oracle,
        uint256 startBet,
        uint256 noMoreBets,
        uint256 maxSetWinTime,
        uint256 minRate,
        uint256 maxRate,
        uint256 salt,
        bytes data
    );

    event Play(
        bytes32 indexed betId,
        uint256 amount,
        uint256 reward,
        bytes32 option,
        bytes data
    );

    event Collect(bytes32 indexed betId, uint256 amount, uint256 reward, bytes data);

    event SetWinOption(bytes32 indexed betId, bytes32 option);

    event EmergencyWithdraw(bytes32 indexed betId, uint256 amount);

    struct Bet {
        IERC20 erc20;
        address oracle;
        mapping(address => uint256) balanceOf;
        mapping(bytes32 => uint256) optionBalanceOf;
        mapping(address => bytes32) optionOf;
        bytes32 winOption;
        uint256 totalBalance;

        uint48 startBet;
        uint48 noMoreBets;
        uint48 setWinTime;
        uint48 minRate;
        uint48 maxRate;
    }

    PlayToken public PLAY;
    bool public canMigrate = true;

    mapping(bytes32 => Bet) public bets;

    constructor () {
        PlayToken _PLAY = new PlayToken();
        _PLAY.transferFeeOwnership(msg.sender);
        setExcludeFromFee(address(_PLAY), true);
        PLAY = _PLAY;
    }

    function getBetBalanceOf(bytes32 _betId, address _account) external view returns(uint256) {
        return bets[_betId].balanceOf[_account];
    }

    function getBetOptionOf(bytes32 _betId, address _account) external view returns(bytes32) {
        return bets[_betId].optionOf[_account];
    }

    function getBetOptionBalance(bytes32 _betId, bytes32 _option) external view returns(uint256) {
        return bets[_betId].optionBalanceOf[_option];
    }

    function getPlayRate(bytes32 _betId, uint256 _timestamp) external view returns(uint256) {
        return _getPlayRate(bets[_betId], _timestamp);
    }

    function create(
        IERC20  _erc20,
        address _oracle,
        uint48  _startBet,
        uint48  _noMoreBets,
        uint48  _maxSetWinTime,
        uint48  _minRate,
        uint48  _maxRate,
        uint256 _salt,
        bytes calldata _data
    ) external nonReentrant returns (bytes32 betId) {
        require(address(_erc20) != address(0), "House::create: The bet erc20 is invalid");
        require(block.timestamp <= _startBet, "House::create: Wrong _startBet");
        require(_startBet < _noMoreBets, "House::create: Wrong _noMoreBets");
        require(_noMoreBets < _maxSetWinTime, "House::create: Wrong _maxSetWinTime");
        require(_minRate <= _maxRate, "House::create: Wrong rates");

        betId = keccak256(abi.encodePacked(
            address(this),
            msg.sender,
            _erc20,
            _oracle,
            _startBet,
            _noMoreBets,
            _maxSetWinTime,
            _minRate,
            _maxRate,
            _salt,
            _data
        ));

        require(bets[betId].oracle == address(0), "House::create: The bet is already create");

        Bet storage bet = bets[betId];
        bet.erc20 = _erc20;
        bet.oracle = _oracle;

        bet.startBet = _startBet;
        bet.noMoreBets = _noMoreBets;
        bet.setWinTime = _maxSetWinTime;

        if (msg.sender == feeOwner) {
            bet.minRate = _minRate;
            bet.maxRate = _maxRate;
        }

        if (_oracle.isContract()) {
            require(
                IBetOracle(_oracle).create(msg.sender, _erc20, _oracle, _noMoreBets, _salt, _data),
                "House::create: The bet oracle reject the create"
            );
        } else {
            require(_oracle != address(0), "House::create: The bet oracle is invalid");
        }

        emit Create(_erc20, _oracle, _startBet, _noMoreBets, _maxSetWinTime, _minRate, _maxRate, _salt, _data);
    }

    function play(
        bytes32 _betId,
        uint256 _amount,
        bytes32 _option,
        bytes calldata _data
    ) external nonReentrant {
        Bet storage bet = bets[_betId];
        uint256 timestamp = block.timestamp;

        require(bet.startBet < timestamp, "House::play: The bet is not open, yet");
        require(timestamp < bet.noMoreBets, "House::play: The bet is closed or not exists");
        require(_amount != 0, "House::play: The amount should not be 0");
        require(_option != bytes32(0), "House::play: The option is invalid");
        require(bet.optionOf[msg.sender] == bytes32(0) || bet.optionOf[msg.sender] == _option, "House::play: The option cant change");

        // Charge fee
        uint256 feeAmount;
        if (feeOwnerRate != 0 && !excludeFromFee[address(bet.erc20)]) {
            feeAmount = _getRateFeeOwnerAmount(_amount);
            bet.erc20.safeTransferFrom(msg.sender, feeOwner, feeAmount);
        }

        // Take tokens
        uint256 netAmount = _amount - feeAmount;
        bet.erc20.safeTransferFrom(msg.sender, address(this), netAmount);

        bet.totalBalance += netAmount;
        bet.balanceOf[msg.sender] += netAmount;
        bet.optionBalanceOf[_option] += netAmount;
        bet.optionOf[msg.sender] = _option;

        uint256 rewardPlay;
        if (address(PLAY) != address(0)) {
            rewardPlay = _getRateAmount(_amount, _getPlayRate(bet, timestamp));
            if (rewardPlay != 0) {
                PLAY.mintTo(msg.sender, rewardPlay);
            }
        }

        if (bet.oracle.isContract()) {
            require(
                IBetOracle(bet.oracle).play(msg.sender, _betId, netAmount, _option, _data),
                "House::play: The bet oracle reject the play"
            );
        }

        emit Play(_betId, netAmount, rewardPlay, _option, _data);
    }

    function setWinOption(bytes32 _betId, bytes32 _option) external {
        Bet storage bet = bets[_betId];

        require(msg.sender == bet.oracle, "House::setWinOption: The tx sender is invalid or not exists");
        require(bet.noMoreBets <= block.timestamp, "House::setWinOption: The bet is not closed");
        require(block.timestamp < bet.setWinTime, "House::setWinOption: The bet is in emergency or the win option was set");
        require(_option != bytes32(0), "House::setWinOption: The win option is invalid");

        bet.winOption = _option;
        bet.setWinTime = uint32(block.timestamp);

        emit SetWinOption(_betId, _option);
    }

    function collect(bytes32 _betId, bytes calldata _data) external nonReentrant {
        Bet storage bet = bets[_betId];

        if (bet.winOption == bytes32(0) && block.timestamp >= bet.setWinTime) { // Bet is in emergency
            uint256 balance = bet.balanceOf[msg.sender];
            require(balance != 0, "House::collect: The sender not have balance");

            delete (bet.balanceOf[msg.sender]);
            bet.erc20.safeTransfer(msg.sender, balance);

            emit EmergencyWithdraw(_betId, balance);

            return;
        }

        require(bet.winOption != bytes32(0), "House::collect: The win option is not set or not exists");
        uint256 collectAmount;
        bytes32 senderOption = bet.optionOf[msg.sender];

        if (senderOption == bet.winOption) { // win
            // (user balance * total bet balance) / option balance
            collectAmount = (bet.balanceOf[msg.sender] * bet.totalBalance) / bet.optionBalanceOf[senderOption];
        } else if (
            bet.winOption != bytes32(0) &&          // The win option is set
            bet.optionBalanceOf[bet.winOption] == 0 // The balance is 0
        ) { // All lose(draw)
            collectAmount = bet.balanceOf[msg.sender];
        } else { // lose
            revert("House::collect: The sender lose or not play");
        }

        delete (bet.balanceOf[msg.sender]);
        bet.erc20.safeTransfer(msg.sender, collectAmount);

        uint256 rewardCollect;
        if (address(PLAY) != address(0)) {
            rewardCollect = _getRateAmount(collectAmount, bet.minRate);
            if (rewardCollect != 0) {
                PLAY.mintTo(msg.sender, rewardCollect);
            }
        }

        if (bet.oracle.isContract()) {
            require(
                IBetOracle(bet.oracle).collect(msg.sender, _betId, collectAmount, _data),
                "House::collect: The bet oracle reject the collect"
            );
        }

        emit Collect(_betId, collectAmount, rewardCollect, _data);
    }

    // Only fee owner

    function renounceMigrate() external onlyFeeOwner {
        canMigrate = false;
    }

    function migrate(address _newContract) external onlyFeeOwner {
        require(canMigrate, "House::migrate: The fee owner was renounce to migrate");
        PLAY.transferOwnership(_newContract);
        delete (PLAY);
    }

    // Internal

    function _getPlayRate(Bet storage _bet, uint256 _timestamp) internal view returns(uint256) {
        uint256 deltaR = _bet.maxRate - _bet.minRate;
        uint256 deltaT = _bet.noMoreBets - _bet.startBet;
        return (deltaR / deltaT) * (_bet.noMoreBets - _timestamp) + _bet.minRate;
    }
}
