# PlayHouse
[![Lint Status](https://github.com/rotcivegaf/PlayHouse/workflows/Lint/badge.svg)](https://github.com/rotcivegaf/PlayHouse/actions?query=workflow%3ALint)
[![Test Status](https://github.com/rotcivegaf/PlayHouse/workflows/Test/badge.svg)](https://github.com/rotcivegaf/PlayHouse/actions?query=workflow%3ATest)
[![Coverage Status](https://github.com/rotcivegaf/PlayHouse/workflows/Coverage/badge.svg)](https://github.com/rotcivegaf/PlayHouse/actions?query=workflow%3ACoverage)
[![Coverage](https://codecov.io/gh/rotcivegaf/PlayHouse/graph/badge.svg)](https://codecov.io/gh/rotcivegaf/PlayHouse)

A House where you can gambling with ERC20 tokens and receive PLAY token rewards for you play and your wins

## PlayToken(ERC20 reward token)

Its a ERC20 token with:
  - Governance
  - Burn fee, 0% to 5%
  - FeeOwner(dev) fee, 0% to 5%
  - Mapping to exclude addresses from fee
  - Mint used by the House contract to reward when play and collect a bet

## House(MasterChef and bet manager)

Used to create, play and collect bets
Manage the ERC20 and mint rewards in PlayToken

```solidity
struct Bet {
    IERC20 erc20;                                // Token of the bet
    address oracle;                              // Oracle of the bet
    mapping(address => uint256) balanceOf;       // Player to balance on the bet
    mapping(bytes32 => uint256) optionBalanceOf; // Option to balance option
    mapping(address => bytes32) optionOf;        // Player to player option
    bytes32 winOption;                           // The win option of the bet
    uint256 totalBalance;                        // Total balance of this bet

    uint48 startBet;   // When the bet is available to play
    uint48 noMoreBets; // When the bet close(cant play anymore)
    uint48 setWinTime; // The max time how have the oracle to set the winner and if set a winner, the set time
    uint48 minRate;    // The min rate reward
    uint48 maxRate;    // The max rate reward
}
```

Haves a feeOwner(like a owner but with fee), how can:
  - Create rewarded bets
  - Renounce to migrate
  - Migrate to other PlayHouse
  - FeeOwner(dev) fee, 0% to 5% when play
  - Exclude addresses from fee

The bet start in create function, anyone can create a bet but if the bet is created by the feeOwner anyone who play can receive rewards in PlayToken
Send a call to the oracle to confirm the create

When the bet has started the players can play and the contract can mint PlayToken when before play, more tokens was mint in function of time between startBet(max rate reward) and noMoreBets(max rate reward):
  - `deltaRate = maxRate - minRate`
  - `deltaTime = noMoreBets - startBet`
  - `rate = (deltaR / deltaT) * (noMoreBets - timestamp) + minRate`
  - `rewards = (amount * rate) / 10000`

Send a call to the oracle to confirm the play

The oracle set the winner of the bet

If the player option is the win option, the player receives `(playerBalance * totalBalance) / balanceOption`
If nobody win(draw) return the playerBalance
If lose.... lose, no recibe anything
The win and the draw also receive: `rewards = (amount * minRate) / 10000`

### Problems:
  - Each oracle of each bet, are centralized
  - The fee owner controls the migrate(can renounce)
  - The fee owner controls mint of PLAY token

### TODOS
  - Compound erc20