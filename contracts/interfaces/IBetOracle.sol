pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IBetOracle {
    // This methods should be sender by the House
    function create(address _sender, IERC20 _erc20, uint256 _noMoreBets, uint256 _salt, bytes calldata _data) external returns(bool success);
    function play(address _sender, bytes32 _betId, uint256 _amount, bytes32 _option, bytes calldata _data) external returns(bool success);
    function collect(address _sender, bytes32 _betId, uint256 _collectAmount, bytes calldata _data) external returns(bool success);

    // Only owner method
    function setWinOption(bytes32 _betId, bytes32 _option) external;
}