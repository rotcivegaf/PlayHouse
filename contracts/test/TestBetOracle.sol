pragma solidity ^0.8.0;

import "../House.sol";
import "../interfaces/IBetOracle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract TestBetOracle is IBetOracle {
    bytes32 public constant TRUE = 0x0000000000000000000000000000000000000000000000000000000054525545;
    House public immutable house;

    constructor (House _house) {
        house = _house;
    }

    function _checkTrue(bytes memory _data) internal pure returns(bool) {
        bytes32 converted;
        assembly {converted := mload(add(_data, 32))}
        return converted == TRUE;
    }

    // This methods should be sender by the House

    function create(address, IERC20, uint256, uint256, bytes calldata _data) external pure override returns(bool) {
        return _checkTrue(_data);
    }

    function play(address, bytes32, uint256, bytes32, bytes calldata _data) external pure override returns(bool) {
        return _checkTrue(_data);
    }

    function setWinOption(bytes32 _betId, bytes32 _option) external override {
        house.setWinOption(_betId, _option);
    }

    function collect(address, bytes32, uint256, bytes calldata _data) external pure override returns(bool) {
        return _checkTrue(_data);
    }
}