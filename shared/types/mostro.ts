/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/mostro.json`.
 */
export type Mostro = {
   address: "6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK";
   metadata: {
      name: "mostro";
      version: "0.1.0";
      spec: "0.1.0";
      description: "Mostro on Solana: $MOST bonding curve, artist perks and MoOG Pass redemption";
   };
   instructions: [
      {
         name: "acceptAdmin";
         discriminator: [112, 42, 45, 90, 116, 181, 13, 170];
         accounts: [
            {
               name: "pendingAdmin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "buyTokensExactOutSol";
         discriminator: [160, 176, 95, 170, 229, 24, 26, 8];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent for the buyer's token account. Usually the buyer; can be a sponsor."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Pays the SOL and receives the tokens."];
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["curve"];
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "buyerAta";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "buyer";
                     },
                     {
                        kind: "account";
                        path: "tokenProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "kyc";
               docs: ["Optional KYC record; `check_kyc` verifies it belongs to the buyer. No seeds so clients can omit it."];
               optional: true;
            },
            {
               name: "tokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "tokensOut";
               type: "u64";
            },
            {
               name: "maxLamportsIn";
               type: "u64";
            },
         ];
      },
      {
         name: "buyTokensSol";
         discriminator: [236, 167, 45, 186, 76, 10, 254, 109];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent for the buyer's token account. Usually the buyer; can be a sponsor."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Pays the SOL and receives the tokens."];
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["curve"];
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "buyerAta";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "buyer";
                     },
                     {
                        kind: "account";
                        path: "tokenProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "kyc";
               docs: ["Optional KYC record; `check_kyc` verifies it belongs to the buyer. No seeds so clients can omit it."];
               optional: true;
            },
            {
               name: "tokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "lamportsIn";
               type: "u64";
            },
            {
               name: "minTokensOut";
               type: "u64";
            },
         ];
      },
      {
         name: "buyTokensUsdc";
         discriminator: [67, 28, 37, 41, 100, 173, 170, 86];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent for the buyer's token account. Usually the buyer; can be a sponsor."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Owns the USDC and receives the tokens."];
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["curve"];
            },
            {
               name: "usdcMint";
               relations: ["config"];
            },
            {
               name: "buyerUsdc";
               writable: true;
            },
            {
               name: "usdcVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "treasuryUsdc";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "config";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "buyerAta";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "buyer";
                     },
                     {
                        kind: "account";
                        path: "tokenProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "priceUpdate";
            },
            {
               name: "kyc";
               docs: ["Optional KYC record; `check_kyc` verifies it belongs to the buyer. No seeds so clients can omit it."];
               optional: true;
            },
            {
               name: "tokenProgram";
            },
            {
               name: "usdcTokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "usdcIn";
               type: "u64";
            },
            {
               name: "minTokensOut";
               type: "u64";
            },
         ];
      },
      {
         name: "cancelAdminTransfer";
         discriminator: [38, 131, 157, 31, 240, 137, 44, 215];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "createArtist";
         discriminator: [19, 246, 64, 224, 207, 250, 83, 11];
         accounts: [
            {
               name: "admin";
               writable: true;
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "config.artist_count";
                        account: "config";
                     },
                  ];
               };
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "authority";
               type: "pubkey";
            },
            {
               name: "name";
               type: "string";
            },
            {
               name: "uri";
               type: "string";
            },
         ];
      },
      {
         name: "createCurve";
         discriminator: [169, 235, 221, 223, 65, 109, 120, 183];
         accounts: [
            {
               name: "admin";
               writable: true;
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "config.curve_count";
                        account: "config";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 105, 110, 116];
                     },
                     {
                        kind: "account";
                        path: "config.curve_count";
                        account: "config";
                     },
                  ];
               };
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "rewardsVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 119, 97, 114, 100, 115];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "usdcMint";
            },
            {
               name: "usdcVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "curve";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "tokenProgram";
            },
            {
               name: "usdcTokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "createCurveArgs";
                  };
               };
            },
         ];
      },
      {
         name: "createPerk";
         discriminator: [48, 204, 67, 28, 230, 199, 6, 245];
         accounts: [
            {
               name: "signer";
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
            },
            {
               name: "curve";
               docs: ["The curve mint the perk is priced in."];
            },
            {
               name: "mint";
            },
            {
               name: "perk";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 101, 114, 107];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "artist.perk_count";
                        account: "artist";
                     },
                  ];
               };
            },
            {
               name: "collection";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 108, 108, 101, 99, 116, 105, 111, 110];
                     },
                     {
                        kind: "account";
                        path: "perk";
                     },
                     {
                        kind: "arg";
                        path: "args.collection_salt";
                     },
                  ];
               };
            },
            {
               name: "artistVault";
               docs: ["Artist vault for this mint, created lazily here so `redeem_perk` never has to."];
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
               };
            },
            {
               name: "mplCoreProgram";
               address: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
            },
            {
               name: "tokenProgram";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "createPerkArgs";
                  };
               };
            },
         ];
      },
      {
         name: "fulfillReceipt";
         discriminator: [34, 193, 30, 176, 25, 238, 73, 51];
         accounts: [
            {
               name: "signer";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
               relations: ["receipt"];
            },
            {
               name: "receipt";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 99, 101, 105, 112, 116];
                     },
                     {
                        kind: "account";
                        path: "receipt.asset";
                        account: "receipt";
                     },
                  ];
               };
            },
         ];
         args: [];
      },
      {
         name: "initializeConfig";
         discriminator: [208, 127, 21, 1, 194, 190, 196, 70];
         accounts: [
            {
               name: "payer";
               docs: ["Must be the program's upgrade authority so nobody can front-run the init."];
               writable: true;
               signer: true;
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "usdcMint";
            },
            {
               name: "treasuryUsdc";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "config";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "program";
               address: "6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK";
            },
            {
               name: "programData";
            },
            {
               name: "usdcTokenProgram";
            },
            {
               name: "associatedTokenProgram";
               address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "initializeConfigArgs";
                  };
               };
            },
         ];
      },
      {
         name: "proposeAdmin";
         discriminator: [121, 214, 199, 212, 87, 39, 117, 234];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "newAdmin";
               type: "pubkey";
            },
         ];
      },
      {
         name: "redeemPerk";
         discriminator: [246, 154, 17, 49, 124, 164, 97, 104];
         accounts: [
            {
               name: "payer";
               docs: ["Pays rent and the Core protocol fee. Usually the buyer; can be a sponsor (Openfort/Kora)."];
               writable: true;
               signer: true;
            },
            {
               name: "buyer";
               docs: ["Owns the tokens being spent and receives the asset."];
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
               relations: ["perk"];
            },
            {
               name: "perk";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 101, 114, 107];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "perk.index";
                        account: "perk";
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["perk", "curve"];
            },
            {
               name: "buyerAta";
               writable: true;
            },
            {
               name: "rewardsVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 119, 97, 114, 100, 115];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "artistVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
               };
            },
            {
               name: "collection";
               writable: true;
               relations: ["perk"];
            },
            {
               name: "asset";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 115, 115, 101, 116];
                     },
                     {
                        kind: "account";
                        path: "perk";
                     },
                     {
                        kind: "arg";
                        path: "nonce";
                     },
                  ];
               };
            },
            {
               name: "receipt";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [114, 101, 99, 101, 105, 112, 116];
                     },
                     {
                        kind: "account";
                        path: "asset";
                     },
                  ];
               };
            },
            {
               name: "passAsset";
               docs: ["Optional MoOG Pass held by the buyer, for discount / early access / VIP gating."];
               optional: true;
            },
            {
               name: "passPerk";
               docs: ["The pass perk the `pass_asset` belongs to."];
               optional: true;
            },
            {
               name: "mplCoreProgram";
               address: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
            },
            {
               name: "tokenProgram";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "nonce";
               type: "u64";
            },
            {
               name: "maxPaid";
               type: "u64";
            },
         ];
      },
      {
         name: "sellTokens";
         discriminator: [114, 242, 25, 12, 62, 126, 92, 2];
         accounts: [
            {
               name: "seller";
               writable: true;
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["curve"];
            },
            {
               name: "solVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [115, 111, 108, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "curve";
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "sellerAta";
               writable: true;
            },
            {
               name: "kyc";
               docs: ["Optional KYC record; `check_kyc` verifies it belongs to the seller. No seeds so clients can omit it."];
               optional: true;
            },
            {
               name: "tokenProgram";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "tokensIn";
               type: "u64";
            },
            {
               name: "minLamportsOut";
               type: "u64";
            },
         ];
      },
      {
         name: "setArtist";
         discriminator: [48, 190, 158, 116, 201, 209, 202, 232];
         accounts: [
            {
               name: "signer";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "setArtistArgs";
                  };
               };
            },
         ];
      },
      {
         name: "setConfig";
         discriminator: [108, 158, 154, 175, 212, 98, 52, 66];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "setConfigArgs";
                  };
               };
            },
         ];
      },
      {
         name: "setCurveMetadata";
         discriminator: [156, 65, 32, 0, 233, 223, 70, 133];
         accounts: [
            {
               name: "admin";
               writable: true;
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "curve";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 117, 114, 118, 101];
                     },
                     {
                        kind: "account";
                        path: "curve.index";
                        account: "curve";
                     },
                  ];
               };
            },
            {
               name: "mint";
               writable: true;
               relations: ["curve"];
            },
            {
               name: "metadata";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [109, 101, 116, 97, 100, 97, 116, 97];
                     },
                     {
                        kind: "account";
                        path: "tokenMetadataProgram";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
                  program: {
                     kind: "account";
                     path: "tokenMetadataProgram";
                  };
               };
            },
            {
               name: "tokenMetadataProgram";
               address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
            {
               name: "rent";
               address: "SysvarRent111111111111111111111111111111111";
            },
         ];
         args: [];
      },
      {
         name: "setKyc";
         discriminator: [143, 253, 67, 18, 64, 198, 83, 190];
         accounts: [
            {
               name: "admin";
               writable: true;
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "kyc";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [107, 121, 99];
                     },
                     {
                        kind: "arg";
                        path: "wallet";
                     },
                  ];
               };
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "wallet";
               type: "pubkey";
            },
            {
               name: "approved";
               type: "bool";
            },
            {
               name: "country";
               type: {
                  array: ["u8", 2];
               };
            },
         ];
      },
      {
         name: "setPerk";
         discriminator: [203, 252, 17, 207, 162, 34, 233, 231];
         accounts: [
            {
               name: "signer";
               signer: true;
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "artist";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
               relations: ["perk"];
            },
            {
               name: "perk";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [112, 101, 114, 107];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "perk.index";
                        account: "perk";
                     },
                  ];
               };
            },
         ];
         args: [
            {
               name: "args";
               type: {
                  defined: {
                     name: "setPerkArgs";
                  };
               };
            },
         ];
      },
      {
         name: "withdrawArtistVault";
         discriminator: [127, 89, 109, 61, 43, 223, 206, 209];
         accounts: [
            {
               name: "authority";
               docs: ["Only the artist authority can withdraw; the protocol admin cannot touch artist vaults."];
               signer: true;
               relations: ["artist"];
            },
            {
               name: "artist";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116];
                     },
                     {
                        kind: "account";
                        path: "artist.index";
                        account: "artist";
                     },
                  ];
               };
            },
            {
               name: "mint";
            },
            {
               name: "artistVault";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [97, 114, 116, 105, 115, 116, 95, 118, 97, 117, 108, 116];
                     },
                     {
                        kind: "account";
                        path: "artist";
                     },
                     {
                        kind: "account";
                        path: "mint";
                     },
                  ];
               };
            },
            {
               name: "destination";
               writable: true;
            },
            {
               name: "tokenProgram";
            },
         ];
         args: [
            {
               name: "amount";
               type: "u64";
            },
         ];
      },
      {
         name: "withdrawTreasurySol";
         discriminator: [183, 223, 87, 23, 30, 186, 126, 187];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "treasury";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [116, 114, 101, 97, 115, 117, 114, 121];
                     },
                  ];
               };
            },
            {
               name: "destination";
               writable: true;
            },
            {
               name: "systemProgram";
               address: "11111111111111111111111111111111";
            },
         ];
         args: [
            {
               name: "amount";
               type: "u64";
            },
         ];
      },
      {
         name: "withdrawTreasuryUsdc";
         discriminator: [241, 92, 1, 1, 13, 159, 80, 136];
         accounts: [
            {
               name: "admin";
               signer: true;
               relations: ["config"];
            },
            {
               name: "config";
               pda: {
                  seeds: [
                     {
                        kind: "const";
                        value: [99, 111, 110, 102, 105, 103];
                     },
                  ];
               };
            },
            {
               name: "usdcMint";
               relations: ["config"];
            },
            {
               name: "treasuryUsdc";
               writable: true;
               pda: {
                  seeds: [
                     {
                        kind: "account";
                        path: "config";
                     },
                     {
                        kind: "account";
                        path: "usdcTokenProgram";
                     },
                     {
                        kind: "account";
                        path: "usdcMint";
                     },
                  ];
                  program: {
                     kind: "const";
                     value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                  };
               };
            },
            {
               name: "destination";
               writable: true;
            },
            {
               name: "usdcTokenProgram";
            },
         ];
         args: [
            {
               name: "amount";
               type: "u64";
            },
         ];
      },
   ];
   accounts: [
      {
         name: "artist";
         discriminator: [142, 136, 31, 244, 208, 44, 128, 145];
      },
      {
         name: "baseAssetV1";
         discriminator: [1];
      },
      {
         name: "baseCollectionV1";
         discriminator: [5];
      },
      {
         name: "config";
         discriminator: [155, 12, 170, 224, 30, 250, 204, 130];
      },
      {
         name: "curve";
         discriminator: [191, 180, 249, 66, 180, 71, 51, 182];
      },
      {
         name: "kyc";
         discriminator: [27, 3, 5, 223, 163, 21, 37, 201];
      },
      {
         name: "perk";
         discriminator: [2, 34, 178, 63, 67, 155, 249, 194];
      },
      {
         name: "receipt";
         discriminator: [39, 154, 73, 106, 80, 102, 145, 153];
      },
   ];
   events: [
      {
         name: "adminAccepted";
         discriminator: [174, 12, 76, 139, 158, 99, 110, 254];
      },
      {
         name: "adminProposed";
         discriminator: [129, 249, 226, 227, 199, 82, 110, 243];
      },
      {
         name: "adminTransferCancelled";
         discriminator: [93, 23, 69, 55, 216, 128, 106, 56];
      },
      {
         name: "artistCreated";
         discriminator: [101, 78, 4, 44, 142, 133, 209, 205];
      },
      {
         name: "artistUpdated";
         discriminator: [51, 184, 188, 50, 40, 83, 44, 59];
      },
      {
         name: "artistVaultWithdrawn";
         discriminator: [192, 150, 188, 116, 117, 178, 119, 165];
      },
      {
         name: "configInitialized";
         discriminator: [181, 49, 200, 156, 19, 167, 178, 91];
      },
      {
         name: "configUpdated";
         discriminator: [40, 241, 230, 122, 11, 19, 198, 194];
      },
      {
         name: "curveCreated";
         discriminator: [207, 148, 202, 45, 236, 100, 171, 230];
      },
      {
         name: "kycUpdated";
         discriminator: [93, 95, 129, 3, 177, 236, 12, 233];
      },
      {
         name: "perkCreated";
         discriminator: [43, 38, 171, 237, 200, 44, 219, 199];
      },
      {
         name: "perkRedeemed";
         discriminator: [13, 119, 53, 107, 152, 10, 236, 247];
      },
      {
         name: "perkUpdated";
         discriminator: [129, 27, 145, 8, 43, 158, 57, 242];
      },
      {
         name: "receiptFulfilled";
         discriminator: [233, 218, 183, 192, 156, 80, 118, 161];
      },
      {
         name: "tokensBought";
         discriminator: [151, 148, 173, 226, 128, 30, 249, 190];
      },
      {
         name: "tokensSold";
         discriminator: [217, 83, 68, 137, 134, 225, 94, 45];
      },
      {
         name: "treasuryWithdrawn";
         discriminator: [143, 181, 157, 169, 87, 155, 170, 46];
      },
   ];
   errors: [
      {
         code: 6000;
         name: "paused";
         msg: "Protocol is paused";
      },
      {
         code: 6001;
         name: "unauthorized";
         msg: "Signer is not authorized";
      },
      {
         code: 6002;
         name: "saleNotStarted";
         msg: "Sale has not started yet";
      },
      {
         code: 6003;
         name: "perkInactive";
         msg: "Perk is inactive";
      },
      {
         code: 6004;
         name: "perkSoldOut";
         msg: "Perk is sold out";
      },
      {
         code: 6005;
         name: "slippageExceeded";
         msg: "Slippage limit exceeded";
      },
      {
         code: 6006;
         name: "curveSoldOut";
         msg: "Curve supply cap reached";
      },
      {
         code: 6007;
         name: "curveComplete";
         msg: "Curve is complete; trading is closed";
      },
      {
         code: 6008;
         name: "insufficientReserves";
         msg: "Insufficient real reserves to pay out";
      },
      {
         code: 6009;
         name: "mathOverflow";
         msg: "Arithmetic overflow";
      },
      {
         code: 6010;
         name: "invalidAmount";
         msg: "Invalid amount";
      },
      {
         code: 6011;
         name: "invalidBps";
         msg: "Invalid basis points";
      },
      {
         code: 6012;
         name: "invalidTier";
         msg: "Invalid tier";
      },
      {
         code: 6013;
         name: "invalidCurveParams";
         msg: "Invalid curve parameters";
      },
      {
         code: 6014;
         name: "stringTooLong";
         msg: "String too long";
      },
      {
         code: 6015;
         name: "invalidPriceAccount";
         msg: "Price account does not match config";
      },
      {
         code: 6016;
         name: "priceFeedMismatch";
         msg: "Price feed id mismatch";
      },
      {
         code: 6017;
         name: "priceTooOld";
         msg: "Price is too old";
      },
      {
         code: 6018;
         name: "priceNonPositive";
         msg: "Price is not positive";
      },
      {
         code: 6019;
         name: "priceNotSet";
         msg: "Price not set";
      },
      {
         code: 6020;
         name: "adminTransferNotReady";
         msg: "Admin transfer not ready";
      },
      {
         code: 6021;
         name: "noPendingAdmin";
         msg: "No pending admin transfer";
      },
      {
         code: 6022;
         name: "invalidCollection";
         msg: "Collection does not match perk";
      },
      {
         code: 6023;
         name: "invalidMint";
         msg: "Mint does not match";
      },
      {
         code: 6024;
         name: "kycRequired";
         msg: "KYC approval required";
      },
      {
         code: 6025;
         name: "vipOnly";
         msg: "Perk is VIP-only";
      },
      {
         code: 6026;
         name: "invalidPass";
         msg: "Pass asset is not valid for this buyer";
      },
      {
         code: 6027;
         name: "passMismatch";
         msg: "Pass perk and pass asset do not match";
      },
      {
         code: 6028;
         name: "alreadyFulfilled";
         msg: "Receipt already fulfilled";
      },
      {
         code: 6029;
         name: "artistInactive";
         msg: "Artist is inactive";
      },
      {
         code: 6030;
         name: "invalidDiscount";
         msg: "Discount exceeds price";
      },
      {
         code: 6031;
         name: "priceUncertain";
         msg: "Price confidence interval too wide";
      },
   ];
   types: [
      {
         name: "adminAccepted";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "previous";
                  type: "pubkey";
               },
               {
                  name: "admin";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "adminProposed";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "current";
                  type: "pubkey";
               },
               {
                  name: "proposed";
                  type: "pubkey";
               },
               {
                  name: "readyTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "adminTransferCancelled";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "cancelled";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "artist";
         docs: ['An artist that opens perks to fans. PDA `["artist", index_le]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "authority";
                  docs: ["Wallet allowed to manage this artist's perks and withdraw its vault."];
                  type: "pubkey";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "perkCount";
                  type: "u32";
               },
               {
                  name: "revenueTokens";
                  docs: ["Cumulative tokens routed to the artist vault."];
                  type: "u64";
               },
               {
                  name: "active";
                  type: "bool";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 48];
                  };
               },
            ];
         };
      },
      {
         name: "artistCreated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "authority";
                  type: "pubkey";
               },
               {
                  name: "name";
                  type: "string";
               },
            ];
         };
      },
      {
         name: "artistUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "authority";
                  type: "pubkey";
               },
               {
                  name: "active";
                  type: "bool";
               },
            ];
         };
      },
      {
         name: "artistVaultWithdrawn";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "destination";
                  type: "pubkey";
               },
               {
                  name: "amount";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "baseAssetV1";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "key";
                  type: {
                     defined: {
                        name: "key";
                     };
                  };
               },
               {
                  name: "owner";
                  type: "pubkey";
               },
               {
                  name: "updateAuthority";
                  type: {
                     defined: {
                        name: "updateAuthority";
                     };
                  };
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "seq";
                  type: {
                     option: "u64";
                  };
               },
            ];
         };
      },
      {
         name: "baseCollectionV1";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "key";
                  type: {
                     defined: {
                        name: "key";
                     };
                  };
               },
               {
                  name: "updateAuthority";
                  type: "pubkey";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "numMinted";
                  type: "u32";
               },
               {
                  name: "currentSize";
                  type: "u32";
               },
            ];
         };
      },
      {
         name: "config";
         docs: ['Global protocol configuration. Single PDA `["config"]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "pendingAdmin";
                  type: "pubkey";
               },
               {
                  name: "adminTransferReadyTs";
                  type: "i64";
               },
               {
                  name: "adminCooloffSecs";
                  type: "u32";
               },
               {
                  name: "usdcMint";
                  type: "pubkey";
               },
               {
                  name: "treasuryBump";
                  type: "u8";
               },
               {
                  name: "feeBps";
                  docs: ["Protocol fee on curve trades, in basis points of the quote amount."];
                  type: "u16";
               },
               {
                  name: "paused";
                  type: "bool";
               },
               {
                  name: "kycRequired";
                  docs: ["When true, buying tokens on the curve requires an approved `Kyc` record."];
                  type: "bool";
               },
               {
                  name: "priceMode";
                  docs: ["0 = admin-set price, 1 = Pyth PriceUpdateV2 account."];
                  type: "u8";
               },
               {
                  name: "solUsdPriceE6";
                  docs: ["SOL/USD with 6 decimals (used in `price_mode == 0`)."];
                  type: "u64";
               },
               {
                  name: "priceUpdatedTs";
                  type: "i64";
               },
               {
                  name: "pythSolUsdAccount";
                  type: "pubkey";
               },
               {
                  name: "pythFeedId";
                  type: {
                     array: ["u8", 32];
                  };
               },
               {
                  name: "maxPriceAgeSecs";
                  type: "u32";
               },
               {
                  name: "standardDiscountBps";
                  docs: ["MoOG Pass benefits, enforced on-chain in `redeem_perk`."];
                  type: "u16";
               },
               {
                  name: "vipDiscountBps";
                  type: "u16";
               },
               {
                  name: "standardEarlySecs";
                  type: "u32";
               },
               {
                  name: "vipEarlySecs";
                  type: "u32";
               },
               {
                  name: "curveCount";
                  type: "u32";
               },
               {
                  name: "artistCount";
                  type: "u32";
               },
               {
                  name: "minBurnBps";
                  docs: ["Floors every perk's split must respect (protects protocol economics from artists)."];
                  type: "u16";
               },
               {
                  name: "minRewardsBps";
                  type: "u16";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 60];
                  };
               },
            ];
         };
      },
      {
         name: "configInitialized";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "usdcMint";
                  type: "pubkey";
               },
               {
                  name: "feeBps";
                  type: "u16";
               },
            ];
         };
      },
      {
         name: "configUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "paused";
                  type: "bool";
               },
               {
                  name: "priceMode";
                  type: "u8";
               },
               {
                  name: "solUsdPriceE6";
                  type: "u64";
               },
               {
                  name: "feeBps";
                  type: "u16";
               },
               {
                  name: "kycRequired";
                  type: "bool";
               },
            ];
         };
      },
      {
         name: "createCurveArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "symbol";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "virtualSolReserves";
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
               {
                  name: "supplyCap";
                  type: "u64";
               },
               {
                  name: "saleStartTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "createPerkArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "price";
                  type: "u64";
               },
               {
                  name: "burnBps";
                  type: "u16";
               },
               {
                  name: "rewardsBps";
                  type: "u16";
               },
               {
                  name: "maxSupply";
                  type: "u32";
               },
               {
                  name: "publicStartTs";
                  type: "i64";
               },
               {
                  name: "vipOnly";
                  type: "bool";
               },
               {
                  name: "discountEligible";
                  type: "bool";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "collectionSalt";
                  docs: ["Client-chosen salt for the collection address, so a squatted (pre-funded) PDA can be skipped."];
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "curve";
         docs: ['A bonding curve for one token mint (the first one is $MOST). PDA `["curve", index_le]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "solVaultBump";
                  type: "u8";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "symbol";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "virtualSolReserves";
                  docs: ["Constant-product virtual reserves (pump.fun style), quote = lamports."];
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
               {
                  name: "realSolReserves";
                  docs: ["Real SOL held in `sol_vault` that backs sells (never includes the rent floor)."];
                  type: "u64";
               },
               {
                  name: "realUsdcReserves";
                  docs: ["USDC received through `buy_tokens_usdc` (not sellable back; informational)."];
                  type: "u64";
               },
               {
                  name: "supplyCap";
                  docs: ["Max tokens the curve will ever mint. Reaching it marks the curve `complete`."];
                  type: "u64";
               },
               {
                  name: "tokensSold";
                  type: "u64";
               },
               {
                  name: "totalBurned";
                  type: "u64";
               },
               {
                  name: "rewardsAccrued";
                  type: "u64";
               },
               {
                  name: "saleStartTs";
                  type: "i64";
               },
               {
                  name: "createdAt";
                  type: "i64";
               },
               {
                  name: "complete";
                  type: "bool";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 64];
                  };
               },
            ];
         };
      },
      {
         name: "curveCreated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "curve";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "virtualSolReserves";
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
               {
                  name: "supplyCap";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "initializeConfigArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "admin";
                  type: "pubkey";
               },
               {
                  name: "feeBps";
                  type: "u16";
               },
               {
                  name: "solUsdPriceE6";
                  type: "u64";
               },
               {
                  name: "maxPriceAgeSecs";
                  type: "u32";
               },
               {
                  name: "pythSolUsdAccount";
                  type: "pubkey";
               },
               {
                  name: "pythFeedId";
                  type: {
                     array: ["u8", 32];
                  };
               },
               {
                  name: "adminCooloffSecs";
                  type: "u32";
               },
               {
                  name: "minBurnBps";
                  type: "u16";
               },
               {
                  name: "minRewardsBps";
                  type: "u16";
               },
            ];
         };
      },
      {
         name: "key";
         type: {
            kind: "enum";
            variants: [
               {
                  name: "uninitialized";
               },
               {
                  name: "assetV1";
               },
               {
                  name: "hashedAssetV1";
               },
               {
                  name: "pluginHeaderV1";
               },
               {
                  name: "pluginRegistryV1";
               },
               {
                  name: "collectionV1";
               },
               {
                  name: "groupV1";
               },
            ];
         };
      },
      {
         name: "kyc";
         docs: ['KYC attestation written by the admin after the off-chain ID check. PDA `["kyc", wallet]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "wallet";
                  type: "pubkey";
               },
               {
                  name: "approved";
                  type: "bool";
               },
               {
                  name: "country";
                  docs: ["ISO 3166-1 alpha-2, uppercase ASCII."];
                  type: {
                     array: ["u8", 2];
                  };
               },
               {
                  name: "updatedTs";
                  type: "i64";
               },
            ];
         };
      },
      {
         name: "kycUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "wallet";
                  type: "pubkey";
               },
               {
                  name: "approved";
                  type: "bool";
               },
               {
                  name: "country";
                  type: {
                     array: ["u8", 2];
                  };
               },
            ];
         };
      },
      {
         name: "perk";
         docs: ['Something a fan can redeem tokens for. PDA `["perk", artist, index_le]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "index";
                  type: "u32";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  docs: ["Token the perk is priced in (a curve mint)."];
                  type: "pubkey";
               },
               {
                  name: "collection";
                  docs: ["Metaplex Core collection every redeemed asset is minted into."];
                  type: "pubkey";
               },
               {
                  name: "collectionBump";
                  type: "u8";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  docs: ["Pass tier (0 Standard, 1 VIP). Zero for non-pass perks."];
                  type: "u8";
               },
               {
                  name: "price";
                  docs: ["Price in token base units (6 decimals)."];
                  type: "u64";
               },
               {
                  name: "burnBps";
                  docs: ["Split of the paid amount: burned / rewards vault / artist vault (remainder)."];
                  type: "u16";
               },
               {
                  name: "rewardsBps";
                  type: "u16";
               },
               {
                  name: "maxSupply";
                  docs: ["0 = unlimited."];
                  type: "u32";
               },
               {
                  name: "sold";
                  type: "u32";
               },
               {
                  name: "publicStartTs";
                  docs: ["Unix time when everyone can redeem. Pass holders may redeem earlier."];
                  type: "i64";
               },
               {
                  name: "vipOnly";
                  docs: ["Only VIP pass holders may redeem."];
                  type: "bool";
               },
               {
                  name: "discountEligible";
                  docs: ["Whether pass discounts apply (music & merch per product copy)."];
                  type: "bool";
               },
               {
                  name: "active";
                  type: "bool";
               },
               {
                  name: "name";
                  type: "string";
               },
               {
                  name: "uri";
                  type: "string";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 48];
                  };
               },
            ];
         };
      },
      {
         name: "perkCreated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "collection";
                  type: "pubkey";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "price";
                  type: "u64";
               },
               {
                  name: "maxSupply";
                  type: "u32";
               },
            ];
         };
      },
      {
         name: "perkKind";
         docs: ["Kind of perk an artist opens to fans (mirrors the product copy: pass, music, events, merch)."];
         repr: {
            kind: "rust";
         };
         type: {
            kind: "enum";
            variants: [
               {
                  name: "pass";
               },
               {
                  name: "music";
               },
               {
                  name: "event";
               },
               {
                  name: "merch";
               },
            ];
         };
      },
      {
         name: "perkRedeemed";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "buyer";
                  type: "pubkey";
               },
               {
                  name: "asset";
                  type: "pubkey";
               },
               {
                  name: "receipt";
                  type: "pubkey";
               },
               {
                  name: "edition";
                  type: "u32";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "paid";
                  type: "u64";
               },
               {
                  name: "burned";
                  type: "u64";
               },
               {
                  name: "toRewards";
                  type: "u64";
               },
               {
                  name: "toArtist";
                  type: "u64";
               },
               {
                  name: "discountBps";
                  type: "u16";
               },
               {
                  name: "passUsed";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "perkUpdated";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "price";
                  type: "u64";
               },
               {
                  name: "active";
                  type: "bool";
               },
               {
                  name: "maxSupply";
                  type: "u32";
               },
               {
                  name: "publicStartTs";
                  type: "i64";
               },
               {
                  name: "vipOnly";
                  type: "bool";
               },
               {
                  name: "discountEligible";
                  type: "bool";
               },
               {
                  name: "burnBps";
                  type: "u16";
               },
               {
                  name: "rewardsBps";
                  type: "u16";
               },
            ];
         };
      },
      {
         name: "receipt";
         docs: ['Proof of a redemption, keyed by the minted asset. PDA `["receipt", asset]`.'];
         type: {
            kind: "struct";
            fields: [
               {
                  name: "bump";
                  type: "u8";
               },
               {
                  name: "version";
                  type: "u8";
               },
               {
                  name: "buyer";
                  type: "pubkey";
               },
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "artist";
                  type: "pubkey";
               },
               {
                  name: "asset";
                  type: "pubkey";
               },
               {
                  name: "edition";
                  type: "u32";
               },
               {
                  name: "kind";
                  type: {
                     defined: {
                        name: "perkKind";
                     };
                  };
               },
               {
                  name: "tier";
                  type: "u8";
               },
               {
                  name: "paid";
                  type: "u64";
               },
               {
                  name: "burned";
                  type: "u64";
               },
               {
                  name: "toRewards";
                  type: "u64";
               },
               {
                  name: "toArtist";
                  type: "u64";
               },
               {
                  name: "discountBps";
                  type: "u16";
               },
               {
                  name: "passUsed";
                  docs: ["Pass asset used for discount/early access, or default if none."];
                  type: "pubkey";
               },
               {
                  name: "ts";
                  type: "i64";
               },
               {
                  name: "fulfilled";
                  docs: ["Set by the artist once a physical/off-chain perk was delivered."];
                  type: "bool";
               },
               {
                  name: "fulfilledTs";
                  type: "i64";
               },
               {
                  name: "reserved";
                  type: {
                     array: ["u8", 32];
                  };
               },
            ];
         };
      },
      {
         name: "receiptFulfilled";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "receipt";
                  type: "pubkey";
               },
               {
                  name: "perk";
                  type: "pubkey";
               },
               {
                  name: "by";
                  type: "pubkey";
               },
            ];
         };
      },
      {
         name: "setArtistArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "authority";
                  type: {
                     option: "pubkey";
                  };
               },
               {
                  name: "name";
                  type: {
                     option: "string";
                  };
               },
               {
                  name: "uri";
                  type: {
                     option: "string";
                  };
               },
               {
                  name: "active";
                  type: {
                     option: "bool";
                  };
               },
            ];
         };
      },
      {
         name: "setConfigArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "paused";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "kycRequired";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "priceMode";
                  type: {
                     option: "u8";
                  };
               },
               {
                  name: "solUsdPriceE6";
                  type: {
                     option: "u64";
                  };
               },
               {
                  name: "pythSolUsdAccount";
                  type: {
                     option: "pubkey";
                  };
               },
               {
                  name: "pythFeedId";
                  type: {
                     option: {
                        array: ["u8", 32];
                     };
                  };
               },
               {
                  name: "maxPriceAgeSecs";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "feeBps";
                  type: {
                     option: "u16";
                  };
               },
               {
                  name: "standardDiscountBps";
                  type: {
                     option: "u16";
                  };
               },
               {
                  name: "vipDiscountBps";
                  type: {
                     option: "u16";
                  };
               },
               {
                  name: "standardEarlySecs";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "vipEarlySecs";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "minBurnBps";
                  type: {
                     option: "u16";
                  };
               },
               {
                  name: "minRewardsBps";
                  type: {
                     option: "u16";
                  };
               },
            ];
         };
      },
      {
         name: "setPerkArgs";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "price";
                  type: {
                     option: "u64";
                  };
               },
               {
                  name: "active";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "maxSupply";
                  type: {
                     option: "u32";
                  };
               },
               {
                  name: "publicStartTs";
                  type: {
                     option: "i64";
                  };
               },
               {
                  name: "vipOnly";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "discountEligible";
                  type: {
                     option: "bool";
                  };
               },
               {
                  name: "burnBps";
                  type: {
                     option: "u16";
                  };
               },
               {
                  name: "rewardsBps";
                  type: {
                     option: "u16";
                  };
               },
               {
                  name: "uri";
                  type: {
                     option: "string";
                  };
               },
            ];
         };
      },
      {
         name: "tokensBought";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "curve";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "buyer";
                  type: "pubkey";
               },
               {
                  name: "quoteKind";
                  docs: ["0 = SOL, 1 = USDC"];
                  type: "u8";
               },
               {
                  name: "quoteIn";
                  type: "u64";
               },
               {
                  name: "quoteNet";
                  type: "u64";
               },
               {
                  name: "fee";
                  type: "u64";
               },
               {
                  name: "tokensOut";
                  type: "u64";
               },
               {
                  name: "virtualSolReserves";
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "tokensSold";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "curve";
                  type: "pubkey";
               },
               {
                  name: "mint";
                  type: "pubkey";
               },
               {
                  name: "seller";
                  type: "pubkey";
               },
               {
                  name: "tokensIn";
                  type: "u64";
               },
               {
                  name: "lamportsOut";
                  type: "u64";
               },
               {
                  name: "fee";
                  type: "u64";
               },
               {
                  name: "virtualSolReserves";
                  type: "u64";
               },
               {
                  name: "virtualTokenReserves";
                  type: "u64";
               },
            ];
         };
      },
      {
         name: "treasuryWithdrawn";
         type: {
            kind: "struct";
            fields: [
               {
                  name: "destination";
                  type: "pubkey";
               },
               {
                  name: "amount";
                  type: "u64";
               },
               {
                  name: "usdc";
                  type: "bool";
               },
            ];
         };
      },
      {
         name: "updateAuthority";
         type: {
            kind: "enum";
            variants: [
               {
                  name: "none";
               },
               {
                  name: "address";
                  fields: ["pubkey"];
               },
               {
                  name: "collection";
                  fields: ["pubkey"];
               },
            ];
         };
      },
   ];
};
