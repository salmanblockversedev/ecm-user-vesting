# ECMcoinVesting Integration Guide for Vue.js Developers

This guide explains how to integrate the ECMcoinVesting contract into a Vue.js frontend, covering wallet connection, token approval, vesting, releasing tokens, and handling contract errors.

## 1. Prerequisites

- Vue.js project (Vue 3 recommended)
- Ethers.js (for interacting with Ethereum)
- Wallet provider (e.g., MetaMask)
- ABI and contract address for ECMcoinVesting and ERC20 token

## 2. Wallet Connection

Use Ethers.js to connect to the user's wallet:

```js
import { ethers } from 'ethers';

async function connectWallet() {
	if (window.ethereum) {
		await window.ethereum.request({ method: 'eth_requestAccounts' });
		const provider = new ethers.BrowserProvider(window.ethereum);
		const signer = await provider.getSigner();
		return { provider, signer };
	}
	throw new Error('No wallet found');
}
```

## 3. Approving Tokens for Vesting

Before vesting, users must approve the ECMcoinVesting contract to spend their tokens:

```js
const erc20 = new ethers.Contract(tokenAddress, erc20Abi, signer);
const vestingAddress = '...'; // ECMcoinVesting contract address
const amount = ethers.parseEther('100'); // Amount to vest
await erc20.approve(vestingAddress, amount);
```

## 4. Vesting Tokens

Call `vestTokens` to start vesting:

```js
const vesting = new ethers.Contract(vestingAddress, vestingAbi, signer);
await vesting.vestTokens(amount);
```

After vesting, you can fetch the user's vesting schedules:

```js
const count = await vesting.getVestingSchedulesCountByBeneficiary(userAddress);
const schedules = [];
for (let i = 0; i < count; i++) {
	const id = await vesting.computeVestingScheduleIdForAddressAndIndex(userAddress, i);
	const schedule = await vesting.getVestingSchedule(id);
	schedules.push({ id, ...schedule });
}
```

## 5. Releasing Vested Tokens

To release vested tokens after the cliff period:

```js
const releasable = await vesting.computeReleasableAmount(scheduleId);
if (releasable > 0) {
	await vesting.release(scheduleId, releasable);
}
```

## 6. Withdrawing Unallocated Tokens (Owner Only)

The contract owner can withdraw unallocated tokens:

```js
await vesting.withdraw(amount);
```

## 7. Error Handling

Handle custom errors and revert reasons in your UI:

- `AmountMustBePositive`: User tried to vest zero tokens.
- `NotEnoughWithdrawableFunds`: Owner tried to withdraw more than available.
- `NotBeneficiaryOrOwner`: Only the beneficiary or owner can release tokens.
- `InsufficientReleasable`: Tried to release more than vested or before cliff.
- `NotRevocable`: Owner tried to revoke an irrevocable schedule.
- `ScheduleNotFound`: Invalid schedule ID used.

Show user-friendly messages for these errors.

## 8. UI Suggestions

- Show user's vesting schedules and their status (amount, cliff, duration, released, releasable).
- Display countdown to cliff and vesting completion.
- Provide buttons for approve, vest, release, and withdraw (owner only).
- Show transaction status and error messages.

## 9. Example Workflow

1. User connects wallet.
2. User approves ECMcoinVesting contract for desired token amount.
3. User calls `vestTokens` to start vesting.
4. UI displays vesting schedules and progress.
5. After cliff, user can release vested tokens.
6. Owner can withdraw unallocated tokens.

## 10. Advanced

- Support multiple vestings per user (show all schedules).
- Handle large amounts and edge cases.
- Use Ethers.js event listeners to update UI on contract events (`VestingScheduleCreated`, `TokensReleased`, `Withdraw`).

## 11. References

- ECMcoinVesting ABI and address
- ERC20 ABI and address
- Ethers.js documentation: https://docs.ethers.org/
