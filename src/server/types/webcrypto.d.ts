// Typy WebCrypto dla testów serwera, które szyfrują jak przeglądarka (`src/client/crypto` w acceptance.test.ts).
// Serwer nie ma `lib: DOM`; w Node te same klasy są w `node:crypto` (`webcrypto`). Kod aplikacji serwera ich nie używa.
type CryptoKey = import('node:crypto').webcrypto.CryptoKey
type CryptoKeyPair = import('node:crypto').webcrypto.CryptoKeyPair
