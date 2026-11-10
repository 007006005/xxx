# Portale licenze: migrazione token RS256

Questa modifica va applicata al PHP del portale, non al servizio Render. Non copiare mai la chiave privata nel repository o nelle variabili Render.

## 1. Generare una coppia RSA sul server PHP

Eseguire sul server del portale (o su una macchina amministrativa sicura):

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out zero-license-private.pem
openssl pkey -in zero-license-private.pem -pubout -out zero-license-public.pem
```

Conservare `zero-license-private.pem` solo sul server PHP e configurarla come variabile d'ambiente `LIC_PRIVATE_KEY`. Copiare il contenuto di `zero-license-public.pem` nella variabile Render `LICENSE_PUBLIC_KEY`. Non inviare né committare la chiave privata.

## 2. Sostituire la funzione lic_token() nel PHP

Rimuovere la vecchia costante `LIC_SECRET` e sostituire la funzione `lic_token` con:

```php
function lic_b64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function lic_token(string $key, int $licenseExp, int $maxBots = 40): string
{
    $privatePem = getenv('LIC_PRIVATE_KEY');
    if (!$privatePem) {
        throw new RuntimeException('LIC_PRIVATE_KEY non configurata');
    }
    $privatePem = str_replace('\\n', "\n", $privatePem);
    $privateKey = openssl_pkey_get_private($privatePem);
    if ($privateKey === false) {
        throw new RuntimeException('Chiave privata RS256 non valida');
    }

    $now = time();
    $exp = min($licenseExp, $now + 900);
    if ($exp <= $now) {
        throw new RuntimeException('Licenza scaduta');
    }

    $header = lic_b64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT'], JSON_THROW_ON_ERROR));
    $payload = lic_b64url(json_encode([
        'iss' => 'https://master-elettroerosioni.it',
        'aud' => 'zero-render-engine',
        'sub' => hash('sha256', $key),
        'maxBots' => max(1, min(200, $maxBots)),
        'iat' => $now,
        'exp' => $exp,
    ], JSON_THROW_ON_ERROR));

    $input = $header . '.' . $payload;
    if (!openssl_sign($input, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Firma RS256 non riuscita');
    }
    openssl_free_key($privateKey);
    return $input . '.' . lic_b64url($signature);
}
```

## 3. Modificare la risposta dell'azione verify

Nel blocco `lic_vout([...])` del ramo `valid => true`, calcolare:

```php
$maxBots = 40;
$tokenExp = min((int)$pub['expires_ts'], time() + 900);
```

e usare:

```php
'token' => lic_token($key, (int)$pub['expires_ts'], $maxBots),
'max_bots' => $maxBots,
'token_expires_ts' => $tokenExp,
```

Mantenere gli altri campi della risposta (`valid`, `user`, `type`, `expires_ts`, `days_left`).

## 4. Configurazione Render

Aggiungere `LICENSE_PUBLIC_KEY` con il PEM pubblico completo. Render non deve ricevere `LIC_PRIVATE_KEY`, `LIC_SECRET` o la chiave licenza dell'utente. Il servizio non usa più MySQL per le licenze.

## 5. Verifica prima dell'uso

- Il PHP deve restituire un JWT a tre segmenti con header `alg=RS256`.
- Il claim `sub` deve essere l'hash SHA-256 esadecimale della chiave licenza, mai la chiave stessa.
- `iss`, `aud`, `iat`, `exp` e `maxBots` devono corrispondere esattamente al contratto sopra.
- Eseguire una verifica licenza e una chiamata protetta `GET /api/status` con Bearer token.
- Non abilitare le connessioni ai server di gioco: `GAME_CONNECTIONS_ENABLED` deve restare `false`.
