/**
 * Smart-account invocation helper for OZ stellar-contracts smart accounts.
 *
 * Signs SorobanAuthorizationEntry for the smart account with the custom
 * AuthPayload signature type:
 *   AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32> }
 * where the ed25519 External signer signs:
 *   auth_digest = sha256(signature_payload || xdr(Vec<u32> context_rule_ids))
 *
 * Usage:
 *   node sa.js add-rule
 *   node sa.js transfer <amountStroops> <ruleId> [donorAmountStroops]
 *
 * If donorAmountStroops is given, the transaction footprint/resources are
 * taken from an enforcing simulation of a transfer of donorAmount (which
 * passes the policy), while the submitted transaction carries amountStroops.
 * This lets us land an on-chain FAILED transaction proving the policy block.
 */
const {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Address,
  StrKey,
  hash,
  nativeToScVal,
  rpc,
  xdr,
} = require('@stellar/stellar-sdk');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const PASSPHRASE = Networks.TESTNET;
const NETWORK_ID = hash(Buffer.from(PASSPHRASE));

const feePayer = Keypair.fromSecret(cfg.feePayerSecret);
const signerKp = Keypair.fromSecret(cfg.signerSecret);
const signerPub = signerKp.rawPublicKey(); // 32 bytes

function signerScVal() {
  // Signer::External(verifier: Address, key_data: Bytes)
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(cfg.verifier).toScVal(),
    xdr.ScVal.scvBytes(signerPub),
  ]);
}

function authPayloadScVal(ruleIds, sig) {
  // struct AuthPayload { context_rule_ids: Vec<u32>, signers: Map<Signer, Bytes> }
  // ScMap keys must be sorted: "context_rule_ids" < "signers"
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: xdr.ScVal.scvVec(ruleIds.map((id) => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: signerScVal(), val: xdr.ScVal.scvBytes(sig) }),
      ]),
    }),
  ]);
}

/** Sign one smart-account auth entry for the given rule ids. */
function signEntry(entry, ruleIds, expirationLedger, nonceOverride) {
  const e2 = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  const creds = e2.credentials().address();
  if (nonceOverride !== undefined) creds.nonce(nonceOverride);
  creds.signatureExpirationLedger(expirationLedger);

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: NETWORK_ID,
      nonce: creds.nonce(),
      signatureExpirationLedger: expirationLedger,
      invocation: e2.rootInvocation(),
    }),
  );
  const signaturePayload = hash(preimage.toXDR());
  const ruleIdsXdr = xdr.ScVal.scvVec(ruleIds.map((id) => xdr.ScVal.scvU32(id))).toXDR();
  const authDigest = hash(Buffer.concat([signaturePayload, ruleIdsXdr]));
  const sig = signerKp.sign(authDigest);
  creds.signature(authPayloadScVal(ruleIds, sig));
  return e2;
}

async function buildOpTx(op) {
  const account = await server.getAccount(feePayer.publicKey());
  return new TransactionBuilder(account, { fee: '1000000', networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(300)
    .build();
}

async function simulateOrThrow(tx, label) {
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    const err = new Error(`[${label}] simulation failed: ${sim.error}`);
    err.sim = sim;
    throw err;
  }
  return sim;
}

async function submit(tx) {
  tx.sign(feePayer);
  const send = await server.sendTransaction(tx);
  if (send.status === 'ERROR') {
    console.log('send error:', JSON.stringify(send.errorResult));
    return { hash: send.hash, status: 'SEND_ERROR', detail: send };
  }
  // poll
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(send.hash);
    if (res.status !== 'NOT_FOUND') return { hash: send.hash, status: res.status, detail: res };
  }
  return { hash: send.hash, status: 'TIMEOUT' };
}

/**
 * Full flow: build op, recording-sim to discover the smart-account auth entry,
 * sign it with AuthPayload, enforcing-sim for footprint, assemble, submit.
 */
async function invokeWithSmartAccountAuth({ contract, func, args, ruleIds, donor }) {
  const op0 = Operation.invokeContractFunction({ contract, function: func, args });
  const tx0 = await buildOpTx(op0);
  const sim0 = await simulateOrThrow(tx0, 'recording');
  const auths = sim0.result.auth || [];
  const saEntry = auths.find((a) => {
    try {
      return (
        Address.fromScAddress(a.credentials().address().address()).toString() ===
        cfg.smartAccount
      );
    } catch {
      return false;
    }
  });
  if (!saEntry) throw new Error('no smart-account auth entry found in simulation');
  const expiration = sim0.latestLedger + 500;

  const signed = signEntry(saEntry, ruleIds, expiration);

  let sorobanData, minResourceFee;
  if (donor) {
    // Enforcing-sim a passing variant (donor args) with the same nonce to get
    // a valid footprint, then submit the failing variant with that footprint.
    const donorOp = Operation.invokeContractFunction({
      contract,
      function: func,
      args: donor.args,
    });
    const donorTx0 = await buildOpTx(donorOp);
    const donorSim0 = await simulateOrThrow(donorTx0, 'donor-recording');
    const donorEntry = (donorSim0.result.auth || []).find((a) => {
      try {
        return (
          Address.fromScAddress(a.credentials().address().address()).toString() ===
          cfg.smartAccount
        );
      } catch {
        return false;
      }
    });
    const nonce = signed.credentials().address().nonce();
    const donorSigned = signEntry(donorEntry, ruleIds, expiration, nonce);
    const donorOp2 = Operation.invokeContractFunction({
      contract,
      function: func,
      args: donor.args,
      auth: [donorSigned],
    });
    const donorTx2 = await buildOpTx(donorOp2);
    const donorSim2 = await simulateOrThrow(donorTx2, 'donor-enforcing');
    sorobanData = donorSim2.transactionData.build();
    minResourceFee = donorSim2.minResourceFee;
  } else {
    const op2 = Operation.invokeContractFunction({ contract, function: func, args, auth: [signed] });
    const tx2 = await buildOpTx(op2);
    const sim2 = await simulateOrThrow(tx2, 'enforcing');
    sorobanData = sim2.transactionData.build();
    minResourceFee = sim2.minResourceFee;
  }

  const account = await server.getAccount(feePayer.publicKey());
  const finalTx = new TransactionBuilder(account, {
    fee: (BigInt(minResourceFee) + 1000000n).toString(),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({ contract, function: func, args, auth: [signed] }))
    .setSorobanData(sorobanData)
    .setTimeout(300)
    .build();

  return submit(finalTx);
}

function i128(n) {
  return nativeToScVal(BigInt(n), { type: 'i128' });
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);

  if (mode === 'add-rule') {
    // add_context_rule(context_type, name, valid_until, signers, policies)
    const args = [
      // ContextRuleType::CallContract(xlmSac)
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CallContract'), new Address(cfg.xlmSac).toScVal()]),
      xdr.ScVal.scvString('spend_limit'),
      xdr.ScVal.scvVoid(), // Option<u32> None
      xdr.ScVal.scvVec([signerScVal()]),
      // Map<Address, Val>: policy -> SpendingLimitAccountParams
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: new Address(cfg.policy).toScVal(),
          val: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('period_ledgers'),
              val: xdr.ScVal.scvU32(cfg.periodLedgers),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('spending_limit'),
              val: i128(cfg.spendingLimit),
            }),
          ]),
        }),
      ]),
    ];
    // Authorized by the constructor-created Default rule (id 0).
    const res = await invokeWithSmartAccountAuth({
      contract: cfg.smartAccount,
      func: 'add_context_rule',
      args,
      ruleIds: [0],
    });
    console.log(JSON.stringify({ mode, hash: res.hash, status: res.status }, null, 2));
    if (res.detail && res.detail.returnValue) {
      console.log('returnValue:', JSON.stringify(rpc.Api ? res.detail.returnValue : null));
    }
    return;
  }

  if (mode === 'transfer') {
    const amount = rest[0];
    const ruleId = parseInt(rest[1], 10);
    const donorAmount = rest[2];
    const args = [
      new Address(cfg.smartAccount).toScVal(),
      new Address(cfg.recipient).toScVal(),
      i128(amount),
    ];
    const donor = donorAmount
      ? {
          args: [
            new Address(cfg.smartAccount).toScVal(),
            new Address(cfg.recipient).toScVal(),
            i128(donorAmount),
          ],
        }
      : undefined;
    try {
      const res = await invokeWithSmartAccountAuth({
        contract: cfg.xlmSac,
        func: 'transfer',
        args,
        ruleIds: [ruleId],
        donor,
      });
      console.log(JSON.stringify({ mode, amount, hash: res.hash, status: res.status }, null, 2));
      if (res.detail && res.detail.resultXdr) {
        console.log('resultXdr:', res.detail.resultXdr.toXDR('base64'));
      }
      if (res.detail && res.detail.diagnosticEventsXdr) {
        for (const ev of res.detail.diagnosticEventsXdr) {
          console.log('diag:', ev.toXDR ? ev.toXDR('base64') : JSON.stringify(ev));
        }
      }
    } catch (e) {
      console.log('FAILED:', e.message);
      process.exitCode = 1;
    }
    return;
  }

  throw new Error('unknown mode: ' + mode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
