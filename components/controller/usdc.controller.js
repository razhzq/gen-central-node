const { ethers } = require('ethers');
const { query } = require('../../db');

// Load contract ABIs
const MockUSDC_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

// Contract addresses (Mantle Testnet)
const MOCK_USDC_ADDRESS = "0xb460FB0a4F68713C4d2c3BD2B96C3B3f37634601";
const MANTLE_TESTNET_RPC = process.env.MANTLE_TESTNET_RPC || "https://rpc.sepolia.mantle.xyz";

/**
 * Check user's USDC balance and auto-mint if zero
 * Also check MNT (gas) balance and transfer if needed
 * For first-time users or users with low balance
 */
const checkAndMintUSDCCtrl = async (req, res) => {
  const { walletAddress } = req.params;

  try {
    // Validate wallet address
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wallet address' 
      });
    }

    // Setup provider and signer
    const provider = new ethers.JsonRpcProvider(MANTLE_TESTNET_RPC);
    const privateKey = process.env.PRIVATE_KEY;
    
    if (!privateKey) {
      console.error('PRIVATE_KEY not set in environment');
      return res.status(500).json({ 
        success: false, 
        error: 'Server configuration error' 
      });
    }

    const signer = new ethers.Wallet(privateKey, provider);
    const usdcContract = new ethers.Contract(MOCK_USDC_ADDRESS, MockUSDC_ABI, signer);

    // Check USDC balance
    const usdcBalance = await usdcContract.balanceOf(walletAddress);
    const usdcBalanceFormatted = ethers.formatUnits(usdcBalance, 6); // USDC has 6 decimals

    // Check MNT (native token) balance for gas
    const mntBalance = await provider.getBalance(walletAddress);
    const mntBalanceFormatted = ethers.formatEther(mntBalance);

    console.log(`[Balance Check] Wallet: ${walletAddress}`);
    console.log(`[Balance Check] USDC: ${usdcBalanceFormatted}, MNT: ${mntBalanceFormatted}`);

    let usdcMinted = false;
    let mntTransferred = false;
    let usdcTxHash = null;
    let mntTxHash = null;
    let newUsdcBalance = usdcBalanceFormatted;
    let newMntBalance = mntBalanceFormatted;

    // 1. Check and mint USDC if balance is zero
    if (usdcBalance === 0n) {
      console.log(`[USDC Mint] Minting 10,000 USDC to ${walletAddress}...`);
      
      const mintAmount = ethers.parseUnits("10000", 6); // 10,000 USDC
      const usdcTx = await usdcContract.mint(walletAddress, mintAmount);
      usdcTxHash = usdcTx.hash;
      
      console.log(`[USDC Mint] Transaction hash: ${usdcTxHash}`);
      
      // Wait for confirmation
      const receipt = await usdcTx.wait();
      console.log(`[USDC Mint] Confirmed in block ${receipt.blockNumber}`);

      // Get new balance
      const updatedUsdcBalance = await usdcContract.balanceOf(walletAddress);
      newUsdcBalance = ethers.formatUnits(updatedUsdcBalance, 6);
      usdcMinted = true;

      // Record USDC mint as DEPOSIT transaction in database
      try {
        // Get or create user
        let userResult = await query(
          `SELECT id FROM users WHERE wallet_address = $1`,
          [walletAddress]
        );

        let userId;
        if (userResult.rows.length === 0) {
          // Create user if doesn't exist
          // Use wallet_address as conflict key (primary identifier)
          const newUser = await query(
            `INSERT INTO users (wallet_address, email, available_balance)
             VALUES ($1, $2, 0.00)
             ON CONFLICT (wallet_address) DO UPDATE
             SET email = EXCLUDED.email, updated_at = now()
             RETURNING id`,
            [walletAddress, `${walletAddress.substring(0, 8)}@temp.com`]
          );
          userId = newUser.rows[0]?.id;
        } else {
          userId = userResult.rows[0].id;
        }

        if (userId) {
          // Insert DEPOSIT transaction
          await query(
            `INSERT INTO user_transactions 
             (user_id, transaction_type, amount_usd, status, tx_hash, notes)
             VALUES ($1, 'DEPOSIT', 10000.00, 'COMPLETED', $2, 'Auto-minted test USDC for new user')`,
            [userId, usdcTxHash]
          );
          console.log('[USDC] Recorded mint as DEPOSIT transaction');
        }
      } catch (dbError) {
        console.error('[USDC] Failed to record mint in database:', dbError);
        // Don't fail the whole request if DB insert fails
      }
    }

    // 2. Check and transfer MNT for gas if balance is low (< 1 MNT)
    const mntThreshold = ethers.parseEther("1"); // 1 MNT threshold
    if (mntBalance < mntThreshold) {
      console.log(`[MNT Transfer] User has low gas balance (${mntBalanceFormatted} MNT)`);
      console.log(`[MNT Transfer] Sending 5 MNT for gas to ${walletAddress}...`);
      
      try {
        const mntAmount = ethers.parseEther("5"); // 5 MNT
        const mntTx = await signer.sendTransaction({
          to: walletAddress,
          value: mntAmount
        });
        mntTxHash = mntTx.hash;
        
        console.log(`[MNT Transfer] Transaction hash: ${mntTxHash}`);
        
        // Wait for confirmation
        const mntReceipt = await mntTx.wait();
        console.log(`[MNT Transfer] Confirmed in block ${mntReceipt.blockNumber}`);

        // Get new MNT balance
        const updatedMntBalance = await provider.getBalance(walletAddress);
        newMntBalance = ethers.formatEther(updatedMntBalance);
        mntTransferred = true;

        console.log(`[MNT Transfer] New balance: ${newMntBalance} MNT`);
      } catch (mntError) {
        console.error('[MNT Transfer Error]', mntError);
        // Don't fail the whole request if MNT transfer fails
        // USDC mint is more critical
      }
    }

    // Return comprehensive response
    if (usdcMinted || mntTransferred) {
      const messages = [];
      if (usdcMinted) messages.push('10,000 USDC minted');
      if (mntTransferred) messages.push('5 MNT transferred for gas');

      return res.json({
        success: true,
        usdc: {
          minted: usdcMinted,
          amount: usdcMinted ? "10000" : "0",
          balance: newUsdcBalance,
          txHash: usdcTxHash
        },
        mnt: {
          transferred: mntTransferred,
          amount: mntTransferred ? "5" : "0",
          balance: newMntBalance,
          txHash: mntTxHash
        },
        message: `Successfully ${messages.join(' and ')}!`
      });
    }

    // No minting or transfer needed
    return res.json({
      success: true,
      usdc: {
        minted: false,
        balance: usdcBalanceFormatted
      },
      mnt: {
        transferred: false,
        balance: mntBalanceFormatted
      },
      message: 'You already have sufficient USDC and MNT in your wallet'
    });

  } catch (error) {
    console.error('[USDC Error]', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to check/mint USDC',
      details: error.message 
    });
  }
};

/**
 * Get user's USDC balance
 */
const getUSDCBalanceCtrl = async (req, res) => {
  const { walletAddress } = req.params;

  try {
    // Validate wallet address
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid wallet address' 
      });
    }

    // Setup provider
    const provider = new ethers.JsonRpcProvider(MANTLE_TESTNET_RPC);
    const usdcContract = new ethers.Contract(MOCK_USDC_ADDRESS, MockUSDC_ABI, provider);

    // Get balance
    const balance = await usdcContract.balanceOf(walletAddress);
    const balanceFormatted = ethers.formatUnits(balance, 6);

    return res.json({
      success: true,
      balance: balanceFormatted,
      balanceWei: balance.toString(),
      token: 'USDC',
      decimals: 6
    });

  } catch (error) {
    console.error('[USDC Balance Error]', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to get USDC balance',
      details: error.message 
    });
  }
};

module.exports = {
  checkAndMintUSDCCtrl,
  getUSDCBalanceCtrl
};
