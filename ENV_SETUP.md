# Backend Environment Variables Setup

## Required Environment Variables

Create a `.env` file in the `gen-central-node` directory with the following variables:

```bash
# ============================================
# Server Configuration
# ============================================
PORT=3000
NODE_ENV=development

# ============================================
# PostgreSQL Database Configuration
# ============================================
PG_HOST=localhost
PG_PORT=5432
PG_USER=your_db_user
PG_PASSWORD=your_db_password
PG_DATABASE=gen_db
PG_SSL=false

# ============================================
# Blockchain Configuration (Mantle Network)
# ============================================
# Deployer's private key (used for minting Mock USDC)
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Mantle Network RPC URLs
MANTLE_RPC=https://rpc.mantle.xyz
MANTLE_TESTNET_RPC=https://rpc.sepolia.mantle.xyz
```

## Variable Details

### Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Port number for the backend server |
| `NODE_ENV` | No | `development` | Environment mode (development/production) |

### PostgreSQL Database

| Variable | Required | Description |
|----------|----------|-------------|
| `PG_HOST` | ✅ Yes | Database host (e.g., `localhost`, `your-db.com`) |
| `PG_PORT` | ✅ Yes | Database port (usually `5432`) |
| `PG_USER` | ✅ Yes | Database username |
| `PG_PASSWORD` | ✅ Yes | Database password |
| `PG_DATABASE` | ✅ Yes | Database name (e.g., `gen_db`) |
| `PG_SSL` | No | Set to `true` for SSL connections (cloud databases) |

**Used in:** `db/index.js` (lines 9-14)

### Blockchain (Mantle Network)

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | ✅ Yes | Deployer's private key for signing transactions |
| `MANTLE_TESTNET_RPC` | ✅ Yes | Mantle Testnet RPC URL |
| `MANTLE_RPC` | No | Mantle Mainnet RPC URL (for future use) |

**Used in:** `components/controller/usdc.controller.js` (lines 12, 32)

## Setup Instructions

### 1. Create `.env` file

```bash
cd /Users/dolphin/Desktop/gen/central-node/gen-central-node
touch .env
```

### 2. Copy the template above and fill in your values

**For Local Development:**
```bash
PORT=3000
NODE_ENV=development

# Local PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=your_password
PG_DATABASE=gen_db
PG_SSL=false

# Blockchain
PRIVATE_KEY=0x1234567890abcdef...  # Your deployer wallet private key
MANTLE_TESTNET_RPC=https://rpc.sepolia.mantle.xyz
```

**For Production (VPS/Cloud):**
```bash
PORT=3000
NODE_ENV=production

# Cloud PostgreSQL
PG_HOST=your-db-host.com
PG_PORT=5432
PG_USER=gen_user
PG_PASSWORD=strong_secure_password
PG_DATABASE=gen_production
PG_SSL=true

# Blockchain
PRIVATE_KEY=0xYOUR_PRODUCTION_DEPLOYER_KEY
MANTLE_TESTNET_RPC=https://rpc.sepolia.mantle.xyz
```

## Important Security Notes

### ⚠️ PRIVATE_KEY Security

1. **Never commit** `.env` to version control (it's in `.gitignore`)
2. **Use a dedicated wallet** for deployment - NOT your personal wallet
3. **Fund with testnet tokens only** for Mantle Testnet
4. **This wallet pays gas fees** for minting Mock USDC to users
5. **This wallet must own** the MockUSDC contract or have minting permissions

### Getting the Private Key

**From MetaMask:**
1. Click the 3 dots next to your account
2. Select "Account details"
3. Click "Show private key"
4. Enter your password
5. Copy the private key (starts with `0x`)

**⚠️ Create a NEW wallet for this - don't use your main wallet!**

### Funding the Deployer Wallet

The deployer wallet needs:
- **MNT tokens** on Mantle Testnet (for gas fees)
- Get free testnet MNT from: https://faucet.sepolia.mantle.xyz/

## Verification

After setting up `.env`, verify it works:

```bash
# Check database connection
node scripts/check-db.js

# Start the server
npm start

# Should see:
# 🚀 GEN Central Node listening at http://localhost:3000
# PostgreSQL connected
```

## Where Each Variable is Used

### PRIVATE_KEY
- **File:** `components/controller/usdc.controller.js`
- **Line:** 32
- **Purpose:** Signs transactions for minting Mock USDC to users
- **Code:**
  ```javascript
  const privateKey = process.env.PRIVATE_KEY;
  const signer = new ethers.Wallet(privateKey, provider);
  ```

### MANTLE_TESTNET_RPC
- **File:** `components/controller/usdc.controller.js`
- **Line:** 12
- **Purpose:** Connects to Mantle Testnet blockchain
- **Code:**
  ```javascript
  const MANTLE_TESTNET_RPC = process.env.MANTLE_TESTNET_RPC || "https://rpc.sepolia.mantle.xyz";
  const provider = new ethers.JsonRpcProvider(MANTLE_TESTNET_RPC);
  ```

### PG_* Variables
- **File:** `db/index.js`
- **Lines:** 9-14
- **Purpose:** PostgreSQL database connection
- **Code:**
  ```javascript
  const pool = new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  ```

### PORT
- **File:** `index.js`
- **Line:** 8
- **Purpose:** Server port number
- **Code:**
  ```javascript
  const port = process.env.PORT || 3000;
  ```

## Troubleshooting

### Error: "PRIVATE_KEY not set in environment"
- Make sure `.env` file exists in `gen-central-node` directory
- Check that `PRIVATE_KEY` is set in `.env`
- Restart the server after adding the variable

### Error: "Failed to connect to PostgreSQL"
- Verify PostgreSQL is running: `pg_isready`
- Check `PG_*` credentials are correct
- For cloud databases, set `PG_SSL=true`

### Error: "Insufficient funds for gas"
- The deployer wallet needs MNT tokens on Mantle Testnet
- Get free tokens: https://faucet.sepolia.mantle.xyz/

## Example Complete `.env` File

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=mypassword123
PG_DATABASE=gen_db
PG_SSL=false

# Blockchain
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
MANTLE_TESTNET_RPC=https://rpc.sepolia.mantle.xyz
MANTLE_RPC=https://rpc.mantle.xyz
```

---

**✅ After setup, you're ready to:**
1. Run migrations: `npm run migrate` (if not done yet)
2. Start server: `npm start`
3. Test USDC minting with a new user login!
