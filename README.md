
# TokenVesting Contract

## Overview

`TokenVesting` is a linear vesting smart contract for ERC20 tokens, designed for secure, flexible, and gas-efficient token distribution. Users can willingly vest their tokens by transferring them to the contract after approval. Each user can have multiple independent vesting schedules.

## Key Features


- **User-Initiated Vesting:** Any user can vest their tokens by calling `vestTokens` after approving the contract.
- **Linear Vesting:** Tokens vest smoothly and proportionally over time after a cliff period. No stepwise or slice-based vesting.
- **Cliff Support:** No tokens are vested before the cliff. After the cliff, tokens vest linearly until the end of the duration.
- **Multiple Schedules:** Each beneficiary can have multiple independent vesting schedules.
- **Irrevocable Schedules:** All user-initiated schedules are irrevocable.
- **Custom Errors:** Uses Solidity custom errors for gas efficiency and clarity (e.g., `InsufficientTokens`, `ZeroAddressBeneficiary`, `NotBeneficiaryOrOwner`, etc.).
- **SafeERC20:** All token transfers use OpenZeppelin's SafeERC20 for maximum compatibility.
- **Reentrancy Protection:** All token transfer functions are protected by `ReentrancyGuard`.
- **Events:** Emits events for schedule creation, release, revocation (for owner-created schedules only), and withdrawals for off-chain tracking.

## Vesting Logic

- **Cliff:** No tokens are vested before the cliff. After the cliff, tokens vest linearly until the end of the duration.
- **Linear Release:** After the cliff, the vested amount increases proportionally with time until the full duration is reached.
- **No Slices:** There is no slice period or stepwise vesting; vesting is continuous.
- **Revocation:** If a schedule is revocable, the owner can revoke it. Any vested tokens are released to the beneficiary, and the unvested portion is returned to the pool.
- **Custom Errors:** All validation uses custom errors for gas savings and clarity.


### Parameters
- Cliff: 3 months (7,776,000 seconds)
- Duration: 6 months (15,552,000 seconds)
- Vesting start: If user vests before 20th Jan 2026, vesting starts on 20th Jan 2026. If after, vesting starts immediately.

## Usage


### User-Initiated Vesting

```
function vestTokens(uint256 amount) external
```
- User must approve the contract to spend their tokens first.
- Transfers tokens from user to contract and creates a new vesting schedule for the user.


### Releasing Vested Tokens

```
function release(bytes32 vestingScheduleId, uint256 amount) external
```
- Can be called by the beneficiary or the owner.
- Releases up to the vested (but unreleased) amount.


### Revoking a Vesting Schedule

```
function revoke(bytes32 vestingScheduleId) external onlyOwner
```
- Only possible for owner-created, revocable schedules (not available for user-initiated vesting).


### Withdrawing Unallocated Tokens

```
function withdraw(uint256 amount) external onlyOwner
```
- Allows the owner to withdraw tokens not allocated to any vesting schedule.

## Security

- **Access Control:** Only the owner can create, revoke, or withdraw.
- **ReentrancyGuard:** All token transfer functions are protected.
- **Custom Errors:** All validation uses custom errors for gas savings and clarity.
- **SafeERC20:** All token transfers use SafeERC20.

## Events

- `VestingScheduleCreated(bytes32 vestingScheduleId, address beneficiary, uint256 start, uint256 cliff, uint256 duration, bool revocable, uint256 amount)`
- `TokensReleased(bytes32 vestingScheduleId, address beneficiary, uint256 amount)`
- `VestingScheduleRevoked(bytes32 vestingScheduleId)`
- `Withdraw(address to, uint256 amount)`


## Example: User-Initiated Vesting

- Cliff: 3 months (7,776,000 seconds)
- Duration: 6 months (15,552,000 seconds)
- Each user can create multiple vesting schedules for themselves by calling `vestTokens` multiple times.

## Testing


Tests are provided in the `test/` directory and cover:
- User-initiated vesting and multiple schedules per user
- Linear vesting and cliff logic
- Revocation (for owner-created schedules only)
- Withdrawals and access control
- Custom error reverts
- Release logic and event emission
- Edge cases: reentrancy, large amounts, timestamp boundaries, access control, and more

## Deployment

1. **Compile contracts:**
   ```shell
   yarn build
   ```
2. **Deploy contract:**
   ```shell
   yarn deploy:verify <network-name>
   ```
3. **Fund contract:**
   Transfer ERC20 tokens to the contract address for vesting.

## Usage

```shell
yarn build
yarn clean
yarn test
yarn test:logs
```

## Deployment

To deploy the ECMCoinICO contract:

1. **Compile the contracts:**
   ```shell
   yarn build
   ```
2. **Prefund the contract:**
   The owner must call `prefundAll(saleAmount, referralAmount, bonusAmount)` to fund the three pools before any purchases can occur. The sum of all pools must be transferred to the contract in ECM tokens.

3. **Deploy using Hardhat Ignition:**
   ```shell
   yarn deploy:verify <network-name>
   ```
   Replace `<network-name>` with your desired network (e.g., `localhost`, `sepolia`, etc.).
   This will deploy the contracts using the `ignition/modules/ECMcoinICO.ts` module.

4. **Verify the contracts (optional):**
   ```shell
   yarn verify:network <network-name>
   ```

Configure your network settings in `hardhat.config.ts` and set up any required environment variables (such as RPC URLs and private keys) in a `.env` file.

## Testing

To run the test suite for ECMCoinICO:

- **Run all tests:**
  ```shell
  yarn test
  ```
- **Run tests with verbose logs (tracing):**
  ```shell
  yarn test:logs
  ```
- **Run tests with gas reporting:**
  ```shell
  REPORT_GAS=true yarn test
  ```

The tests are located in the `test/` directory and cover:
- All major purchase flows (with/without referral, with/without bonus)
- Minimum purchase enforcement
- Cap and pool checks (saleInventory, referralPool, bonusPool)
- Vesting wallet creation, claiming after cliff, and ownership transfer
- Referral and bonus logic
- Oracle staleness and price checks
- Admin and recovery functions
- Pool shortages and edge cases
- Security checks

## Usage

```shell
yarn build
yarn clean
yarn test
yarn test:logs
```
