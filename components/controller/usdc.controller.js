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
 * For first-time users or users with zero balance
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

    // Check current balance
    const balance = await usdcContract.balanceOf(walletAddress);
    const balanceFormatted = ethers.formatUnits(balance, 6); // USDC has 6 decimals

    console.log(`[USDC Check] Wallet: ${walletAddress}, Balance: ${balanceFormatted} USDC`);

    // If balance is zero, mint 10,000 USDC
    if (balance === 0n) {
      console.log(`[USDC Mint] Minting 10,000 USDC to ${walletAddress}...`);
      
      const mintAmount = ethers.parseUnits("10000", 6); // 10,000 USDC
      const tx = await usdcContract.mint(walletAddress, mintAmount);
      
      console.log(`[USDC Mint] Transaction hash: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      
      console.log(`[USDC Mint] Confirmed in block ${receipt.blockNumber}`);

      // Get new balance
      const newBalance = await usdcContract.balanceOf(walletAddress);
      const newBalanceFormatted = ethers.formatUnits(newBalance, 6);

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
          const newUser = await query(
            `INSERT INTO users (wallet_address, email, available_balance)
             VALUES ($1, $2, 0.00)
             ON CONFLICT (email) DO NOTHING
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
            [userId, tx.hash]
          );
          console.log('[USDC] Recorded mint as DEPOSIT transaction');
        }
      } catch (dbError) {
        console.error('[USDC] Failed to record mint in database:', dbError);
        // Don't fail the whole request if DB insert fails
      }

      return res.json({
        success: true,
        minted: true,
        amount: "10000",
        balance: newBalanceFormatted,
        txHash: tx.hash,
        message: 'Successfully minted 10,000 USDC to your wallet!'
      });
    }

    // Balance is not zero, return current balance
    return res.json({
      success: true,
      minted: false,
      balance: balanceFormatted,
      message: 'You already have USDC in your wallet'
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
