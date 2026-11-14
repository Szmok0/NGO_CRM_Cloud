# ZADANIE 01 — Fundament: próbne wdrożenie, logowanie, klucze, role

Status: w realizacji, krok 5 zrobiony (otwarte: limit IP a nagłówek X-Forwarded-For, zob. „Wynik”), następny krok 6 (decyzje D1–D6 zatwierdzone przez MOC 2026-11-14; krok 1 działa na Hostingerze, zob. „Wynik”) · Kontekst: `CLAUDE.md`, `NGO_CRM_CLOUD_KONCEPCJA.md` (4.1–4.3, 4.7), `NGO_CRM_CLOUD_BEZPIECZENSTWO.md` (rozdziały 4 i 5), `NGO_CRM_CLOUD_PROCESY_I_MODEL_DANYCH.md` (2.2) · Wzór: iV_CRM `ZADANIE_02_logowanie_i_wdrozenie.md` i `lib/auth/`

## Cel
Pusta, ale **bezpieczna** aplikacja działa na Hostingerze: organizacja przechodzi kreator pierwszego uruchomienia, zakłada administratora z 2FA i dostaje klucz odzyskiwania do wydruku; administrator zaprasza kolejne osoby. Hasło nie trafia do serwera. Każda metoda API ma przypisane role i test to sprawdza. Na tym fundamencie ZADANIE_02 przeniesie rdzeń z desktopu.

## Poza zakresem (nie rób)
- Moduły domenowe (osoby, działania, zadania itd.) — ZADANIE_02. Tu tylko pusty ekran „Dziś” z menu jak w desktopie.
- Szyfrowanie pól wrażliwych i załączników, nadawanie dostępu do danych wrażliwych, dziennik odsłonięć — ZADANIE_03. **Klucz organizacji, pary kluczy i sloty powstają już tu** (żeby model kluczy był od pierwszego konta), ale nic jeszcze nimi nie szyfrujemy poza samymi kluczami.
- Kopie, panel „Stan bezpieczeństwa”, sprawdzanie nowej wersji — ZADANIE_04.
- Klucze dostępu (passkeys), wysyłka e-maili (link zaproszenia administrator kopiuje i przekazuje sam).
- Instalator, Docker, inne hostingi niż Hostinger.

## Krok 0: przed kodem
1. Przeczytaj `NGO_CRM_CLOUD_BEZPIECZENSTWO.md` (cały), iV_CRM `lib/auth/*` (TOTP, blokada, sesje, zaproszenia, test strażnika) i desktop `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/renderer/lib/api.ts`, `src/renderer/app/Layout.tsx`, `src/renderer/i18n/pl.ts`.
2. **Decyzje do potwierdzenia przez MOC:**
   - **D1. Stack:** Vite + React SPA, Node 22 + Fastify, Drizzle + MySQL/MariaDB (koncepcja 4.7). Plan B przy porażce kroku 1: Next.js jak iV_CRM. **Propozycja: tak.**
   - **D2. Zależności do zatwierdzenia:** produkcyjne `fastify`, `@fastify/cookie`, `@fastify/static`, `drizzle-orm`, `mysql2`, `zod`, `qrcode`, `react`, `react-dom`, zależności shadcn/ui jak w desktopie (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`); deweloperskie `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `typescript`, `vitest`, `drizzle-kit`, `tsx`, `@types/*`. Nagłówki bezpieczeństwa i limit prób logowania piszemy sami (bez `helmet` i `rate-limit`). **Propozycja: tak.**
   - **D3. Model kluczy** z `NGO_CRM_CLOUD_BEZPIECZENSTWO.md`, rozdział 5: PBKDF2 600 000 iteracji → HKDF na `authKey` i `wrapKey`, RSA-OAEP 3072 dla par kluczy, AES-GCM 256 dla klucza organizacji. **Propozycja: tak.**
   - **D4. Sesja:** ważna 12 h, wylogowanie po 30 min bezczynności (ustawialne przez administratora 15–120 min), ciasteczko `SameSite=Strict`. **Propozycja: tak.**
   - **D5. Blokada logowania:** 5 nieudanych prób na konto = 15 min blokady; dodatkowo 20 prób z jednego adresu IP na 15 min (licznik w pamięci, IP nigdzie nie zapisywane). **Propozycja: tak.**
   - **D6. Repo i hosting próbny:** prywatne repo GitHub `Szmok0/NGO_CRM_Cloud` (założone 2026-11-14); próbne wdrożenie jako druga aplikacja Node.js na obecnym planie Hostinger MOC (plan Business pozwala na 5), z osobną bazą MySQL i tymczasowym adresem. **Tylko dane fikcyjne.** **Propozycja: tak.**

## Krok 1: próbne wdrożenie (najpierw, zanim powstanie reszta)
Cel: sprawdzić, że Hostinger uruchamia nasz układ, zanim zbudujemy na nim cokolwiek.
1. Minimalny szkielet: Fastify serwuje zbudowaną stronę Vite (jedna strona „NGO CRM — działa”) i `GET /api/health`, który łączy się z bazą i zwraca wersję aplikacji i numer ostatniej migracji (bez danych).
2. Drizzle z jedną tabelą techniczną i migracją uruchamianą przy starcie serwera.
3. Lokalnie na MariaDB (ta sama instalacja co iV_CRM, osobna baza `ngocrm` i osobny użytkownik).
4. Na Hostingerze (MOC w panelu, Claude prowadzi krok po kroku): baza MySQL, aplikacja Node.js z repozytorium, polecenie budowania `npm run build`, start `npm start`, zmienne `DATABASE_URL`, `APP_SECRET`, `STORAGE_DIR`, `SETUP_TOKEN`.
5. **Sprawdzić i zapisać w „Wyniku” na końcu pliku:** jak Hostinger wykrywa typ aplikacji (Fastify/„inna”), który port i zmienną `PORT` podaje, czy serwer stoi za pośrednikiem HTTPS (nagłówek `X-Forwarded-Proto`), gdzie jest trwała ścieżka na `STORAGE_DIR`, czy migracja przy starcie działa.
6. Jeśli się nie da: zatrzymaj się, opisz przyczynę, wróć do MOC z planem B (D1).

## Krok 2: szkielet aplikacji
- Struktura `src/server`, `src/client`, `src/shared`, `drizzle/`. TypeScript strict w całości; aliasy `@shared`.
- Konfiguracja z walidacją zod przy starcie (`src/server/config.ts`): brak albo za krótki `APP_SECRET` (< 32 bajty), brak `DATABASE_URL` → serwer startuje tylko w trybie kreatora z komunikatem, co ustawić (krok 6).
- Repozytorium zapisu (`src/server/db/repo.ts`) wzorowane na desktopowym: pola techniczne, `version`, `change_log`. Test: zapis ze starą wersją jest odrzucany.
- Logi serwera bez danych osobowych: logujemy metodę, id użytkownika, czas, kod wyniku; **nigdy** parametrów wywołań.
- `.env.example` z opisem każdej zmiennej.
- Polecenia z `CLAUDE.md` (`dev`, `test`, `db:generate`, `typecheck`, `build`, `start`).

## Krok 3: nagłówki, HTTPS, CSRF
- Każda odpowiedź: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (kamera, mikrofon, geolokalizacja wyłączone), `Cross-Origin-Opener-Policy: same-origin`.
- Build Vite bez skryptów i stylów inline (sprawdzić, że CSP niczego nie blokuje: brak błędów w konsoli).
- Bez HTTPS (`X-Forwarded-Proto` ≠ `https` i adres inny niż `localhost`) serwer zwraca stronę „Ta aplikacja działa tylko przez HTTPS” i nie obsługuje API.
- Każde `POST`: nagłówek `Origin` równy adresowi aplikacji i nagłówek `X-NGO-CRM: 1`; inaczej 403.

## Krok 4: kontrakt API i uprawnienia
- `src/shared/api.ts`: metoda → schemat zod parametrów, typ wyniku, **lista ról** (`admin`, `staff`, `readonly`) i flaga, czy metoda jest dostępna przed 2FA (tylko konfiguracja 2FA i wylogowanie).
- `POST /api/rpc` w `src/server/rpc.ts`: sesja → 2FA → rola → walidacja zod → obsługa. Błędy jako kody z `src/shared/errors.ts` (wzór desktopu), komunikaty po polsku w kliencie.
- `src/client/lib/api.ts` z tym samym interfejsem co desktopowe `api.ts` (żeby widoki z ZADANIA_02 przeszły bez zmian).
- **Test uprawnień** (`src/server/rpc.permissions.test.ts`): dla **każdej** metody kontraktu sprawdza, że bez sesji jest 401, z sesją bez 2FA 403 (poza wyjątkami), dla roli spoza listy 403. Nowa metoda bez wpisu ról nie przejdzie typecheck.

## Krok 5: konta, logowanie, 2FA, sesje
- Tabele z `NGO_CRM_CLOUD_PROCESY_I_MODEL_DANYCH.md` 2.2: `settings`, `users`, `auth_sessions`, `invitations`, `org_keys`, `key_slots`, `access_log`, `change_log`.
- **Przeglądarka** (`src/client/crypto/`): PBKDF2 → HKDF (`authKey`, `wrapKey`), para RSA-OAEP, szyfrowanie klucza prywatnego `wrapKey`, losowanie klucza organizacji, slot (klucz organizacji zaszyfrowany kluczem publicznym), klucz odzyskiwania (format do wydruku: grupy po 4 znaki, alfabet bez mylących znaków) i slot odzyskiwania. Testy Vitest na WebCrypto z Node (`globalThis.crypto`): zaszyfruj → odszyfruj, zły klucz → błąd, ten sam e-mail i hasło → ten sam `authKey`.
- **Serwer** (`src/server/auth/`): `authHash = scrypt(authKey)`, porównanie w stałym czasie; TOTP wg RFC 6238 (przeniesione z iV_CRM z testami na wektorach RFC), sekret zaszyfrowany kluczem z `APP_SECRET`; blokada wg D5; sesje wg D4 (w bazie skrót tokenu); „wyloguj wszędzie”; sól pozorna dla nieznanego e-maila.
- Ekrany: logowanie (e-mail → hasło → kod), konfiguracja 2FA z kodem QR i ręcznym kluczem, zmiana hasła (przeszyfrowanie klucza prywatnego w przeglądarce), wylogowanie.
- Po zalogowaniu klucz prywatny odszyfrowany i trzymany tylko w pamięci karty; po odświeżeniu strony stan „zablokowany” (na razie tylko informacja w ustawieniach konta, bo danych wrażliwych jeszcze nie ma).
- Wpisy w `access_log`: `login`, `login_failed`, `logout`, `logout_all`, `password_changed`, `totp_enabled`, `user_invited`, `user_disabled`.

**Decyzje bezpieczeństwa do kroku 5 (MOC, 2026-11-14):**
1. Sesja 12 h od zalogowania, bez przedłużania aktywnością.
2. Bezczynność: stałe 30 min do czasu tabeli `settings` (potem `idleLogoutMinutes`, 15–120).
3. Sesja po haśle, przed kodem 2FA: 5 min.
4. Liczba sesji na osobę: bez limitu (jest „wyloguj wszędzie”).
5. Blokada konta: 5 nieudanych prób = 15 min; błędny kod TOTP liczy się do tych samych 5 prób; licznik zeruje pełne logowanie (hasło i kod).
6. Blokada IP: 20 prób / 15 min, okno stałe, licznik w pamięci (znika po restarcie — akceptowane), IP nigdzie nie zapisywane.
7. PBKDF2: SHA-256, 600 000 iteracji, sól 16 B.
8. HKDF: SHA-256, 256 bitów, etykiety `ngo-crm/auth` i `ngo-crm/wrap`.
9. scrypt na serwerze: N=2^17, r=8, p=1, sól 16 B, skrót 32 B, `maxmem` 256 MB (jak iV_CRM `lib/auth/password.ts`; problem z pamięcią na Hostingerze → zgłosić, nie zmieniać).
10. TOTP: 30 s, 6 cyfr, SHA-1, ±1 okno; ponowne użycie kodu blokowane kolumną `totpLastStep`.
11. Sekret TOTP: klucz z HKDF(`APP_SECRET`), AES-256-GCM.
12. Nieistniejący e-mail: pozorna sól i pozorne iteracje (zawsze 600 000), odpowiedź nieodróżnialna.
13. Ciasteczko: `__Host-ngocrm_session`, `httpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
14. Pary kluczy: RSA-OAEP 3072 (D3).
15. `qrcode` bez `@types/qrcode`: własna deklaracja typów.
16. Testy z bazą tylko na lokalnej bazie testowej (`TEST_DATABASE_URL`, host lokalny, nazwa z `_test`, nie przy `NODE_ENV=production`); konta testowe tylko w testach, sprzątane po nich. Do kroku 6 produkcja nie ma żadnego konta.
17. Sól PBKDF2 losowa dla każdej osoby (`kdfSalt`); e-mail nie wchodzi do wyprowadzenia kluczy. Hasło przed PBKDF2 normalizowane (NFKC).
18. Klucz prywatny szyfrowany `wrapKey`: AES-GCM, losowe IV 96 bitów, dane dodatkowe (AAD) = id konta. Slot związany z wersją klucza organizacji (etykieta RSA-OAEP / AAD).
19. Klucz odzyskiwania: Crockford Base32 (bez I, L, O, U), 14 grup po 4 znaki = 256 bitów klucza + 24 bity sumy kontrolnej (wykrywa literówki); odczyt wybacza małe litery, spacje oraz O/I/L zamiast 0/1.
20. Pola techniczne logowania w `users` (`totpLastStep`, `failedAttempts`, `lockedUntil`, `lastLoginAt`) zapisywane wprost, bez `change_log` i bez zmiany `version` (to nie zmiany danych; zdarzenia logowania trafiają do `access_log`). Sekret TOTP szyfrowany z AAD = id konta. Kod QR: SVG z serwera (bez stylów inline, zgodny z CSP).
21. Logowanie: trasy poza RPC `/api/auth/prelogin`, `/api/auth/login`, `/api/auth/totp`; wylogowanie jako metody RPC (`auth.logout` także przed 2FA, `auth.logoutAll`). Jedna odpowiedź `LOGIN_FAILED` (401) dla złego hasła, nieznanego e-maila, konta wyłączonego i zablokowanego; dla nieznanego e-maila serwer też liczy scrypt (ten sam czas odpowiedzi). Po kodzie TOTP sesja dostaje nowy token.
22. Do limitu IP liczą się tylko nieudane próby (udane są zwracane); przekroczenie → 429 `RATE_LIMITED` do końca okna. Próby w trakcie blokady konta nie są liczone. Adres IP brany z `req.ip` (`trustProxy`), nigdzie nie zapisywany ani logowany.
23. Metody konta w RPC: `auth.account`, `auth.totpSetup.start` / `.confirm` (dostępne przed 2FA; po potwierdzeniu sesja staje się pełna, z nowym tokenem), `auth.keys`, `auth.changePassword`. Błędny kod przy konfiguracji i zmianie hasła: `TOTP_INVALID`.
24. Zmiana hasła: obecny `authKey` + świeży kod TOTP (błędy liczą się do blokady konta; blokada kończy wszystkie sesje); po zmianie pozostałe sesje wylogowane, bieżąca dostaje nowy token; konto z kluczem prywatnym musi przysłać go przeszyfrowanego.
25. Po odświeżeniu strony klucz prywatny znika z pamięci karty: na ekranie konta stan „zablokowany”, bez przycisku „Odblokuj” (dojdzie z danymi wrażliwymi, ZADANIE_03). Wymagania co do hasła sprawdza przeglądarka (min. 12 znaków, nie oczywiste, bez adresu e-mail).
26. `npm run dev:account`: konto próbne tylko do pracy lokalnej (odmawia poza lokalną bazą, przy `NODE_ENV=production`, przy nazwie bazy z hostingu i gdy w bazie są inne konta); hasło losowe, wypisane raz. Kod QR pokazywany jako obrazek `data:` (nie jako HTML).
Realizacja etapami: a) tabele i sesje, b) szyfrowanie w przeglądarce, c) TOTP z QR, d) blokada, e) ekrany; po każdym commit i podsumowanie.

## Krok 6: kreator pierwszego uruchomienia
Działa tylko, gdy w bazie nie ma żadnego użytkownika **i** podano poprawny `SETUP_TOKEN`. Po zakończeniu wyłączony na stałe (także gdy `SETUP_TOKEN` zostanie w panelu; panel „Stan bezpieczeństwa” w ZADANIU_04 przypomni o jego usunięciu).
1. Sprawdzenie: HTTPS, połączenie z bazą, migracje, `APP_SECRET` (gdy brak: pokazuje wygenerowaną wartość do wklejenia w panelu i kończy), zapisywalny `STORAGE_DIR` (próbny plik).
2. Organizacja: nazwa, profil (KGW / darczyńcy / projekty / własny — jak w desktopie).
3. Administrator: imię, e-mail, hasło (min. 12 znaków, siła sprawdzana w przeglądarce), od razu 2FA.
4. Klucz organizacji i klucz odzyskiwania: pokazany raz, do wydruku (strona do druku z przeglądarki) i z potwierdzeniem „wpisz 4 ostatnie znaki”. Tekst wprost: „Bez hasła osoby z dostępem i bez tego klucza danych wrażliwych nie da się odzyskać. Autor programu też ich nie odzyska.”
5. Ekran końcowy: lista kontrolna (usuń `SETUP_TOKEN` z panelu, schowaj wydruk klucza, włącz kopie hostingu).

**Decyzje do kroku 6 (MOC, 2026-11-14):**
1. `SETUP_TOKEN` wpisywany w formularzu, nigdy w adresie strony; co najmniej 32 znaki (przy krótszym kreator odmawia); porównanie w stałym czasie; błędne tokeny liczą się do limitu prób z IP.
2. Nic nie jest zapisywane przed końcem: organizacja, administrator z 2FA, klucz organizacji i oba sloty powstają w jednej transakcji. Sekret TOTP do tego czasu trzyma przeglądarka w postaci zaszyfrowanej przez serwer (ważnej 30 min).
3. Po zakończeniu ekran logowania, bez automatycznego zalogowania.
4. `STORAGE_DIR`: kreator zakłada folder i sprawdza zapis próbnym plikiem; blokuje, gdy zapis się nie udaje albo (w produkcji) folder leży w folderze aplikacji.
5. Limit IP: nagłówkom `X-Forwarded-*` ufamy tylko od pośrednika na tej samej maszynie, a adres klienta to ostatni wpis `X-Forwarded-For` (`trustLocalProxy` w `app.ts`). Uwaga: Fastify celowo traktuje `trustProxy: 1` jako „nie ufaj nikomu”, stąd jawna funkcja.
Bez pytania: profile jak w desktopie (`src/shared/modules.ts`); `idleLogoutMinutes` w `settings` powstaje, ale sesje używają stałych 30 min do czasu ekranu ustawień.
Etapy: a) serwer i testy, b) ekrany i sprawdzenie w przeglądarce. Na produkcji kreator przechodzi MOC.

## Krok 7: użytkownicy
- Ustawienia → Użytkownicy (tylko administrator): lista (imię, e-mail, rola, status, 2FA, ostatnie logowanie), zaproszenie (e-mail, rola) → jednorazowy link ważny 72 h do skopiowania, zmiana roli, wyłączenie konta (koniec wszystkich sesji, usunięcie slotów), reset konta (zapomniane hasło: nowy link, stare sloty usunięte).
- Strona zaproszenia: hasło, 2FA, para kluczy tworzona w przeglądarce. Bez slotu klucza organizacji (nadawanie dostępu w ZADANIU_03).
- Ostatniego aktywnego administratora nie da się wyłączyć ani zdegradować.

## Krok 8: wygląd
- Układ, menu i kolory jak w desktopie (`Layout.tsx`, `styles.css`, krój Inter lokalnie, nie z Google Fonts). Pozycje menu modułów z ZADANIA_02 ukryte albo wyszarzone.
- Ekran „Dziś” pusty z powitaniem. Teksty w `src/client/i18n/pl.ts`.

## Kryteria akceptacji
1. `npm run typecheck`, `npm test` i `npm run build` bez błędów.
2. Na Hostingerze aplikacja otwiera się po HTTPS pod tymczasowym adresem; po HTTP nie obsługuje API.
3. Kreator przechodzi raz, z poprawnym `SETUP_TOKEN`; drugi raz się nie otwiera.
4. W ruchu sieciowym przeglądarki (narzędzia deweloperskie) **nie ma hasła** w żadnym żądaniu; w bazie nie ma niczego, z czego da się odtworzyć hasło lub `wrapKey` bez łamania PBKDF2.
5. Logowanie wymaga hasła i kodu TOTP; 5 błędnych prób blokuje konto na 15 minut.
6. Test uprawnień przechodzi dla wszystkich metod; ręcznie: osoba z rolą `readonly` nie wywoła metody administratora (403).
7. Zaproszona osoba zakłada konto z 2FA; wyłączenie konta kończy jej sesję w innej przeglądarce przy następnym żądaniu.
8. Zmiana hasła: po wylogowaniu stare hasło nie działa, nowe działa, klucz prywatny nadal się odszyfrowuje.
9. Nagłówki z kroku 3 obecne (sprawdzenie np. w narzędziach deweloperskich); konsola przeglądarki bez błędów CSP.
10. Zapis rekordu ze starą `version` daje komunikat „Ktoś zmienił ten rekord w międzyczasie”.
11. W logach serwera (lokalnie i w panelu Hostingera) nie ma e-maili, nazw ani parametrów wywołań.
12. `npm audit` bez podatności wysokich i krytycznych (albo z opisem, dlaczego nie dotyczą).
13. Commit i `git push` po akceptacji MOC.

## Wynik

### Krok 1: próbne wdrożenie (2026-11-14) — działa
Adres próbny: https://ivory-elk-740131.hostingersite.com (`/api/health` → `status: ok`, `https: true`). Plan B (Next.js) niepotrzebny.

- **Typ aplikacji:** w panelu „Fastify”, Node 22, polecenie budowania `npm run build`, plik startowy `dist/server/index.js` (nie `npm start`). Auto-deploy z gałęzi `main` (każdy `git push` buduje i restartuje aplikację w ok. 20 s). Każda wersja ląduje w osobnym folderze `…/hbuilds/versions/<uuid>/nodejs`.
- **Uruchamianie:** Hostinger (LiteSpeed, `lsnode.js`) wczytuje plik startowy przez `require()`. Zbudowany serwer nie może mieć `await` na najwyższym poziomie (`ERR_REQUIRE_ASYNC_MODULE`); start w funkcji `start()`.
- **Katalog bieżący procesu ≠ katalog aplikacji.** Ścieżki (`.env`, `drizzle/`, `dist/client`) liczymy od położenia pliku serwera (`appRoot` w `src/server/config.ts`), nie od `process.cwd()`.
- **Zmienne:** panel podaje je procesowi bezpośrednio, bez pliku `.env`. Zmiana zmiennej w panelu restartuje aplikację (i wywołuje nowy build).
- **Port:** `PORT` z panelu, nasłuch na `0.0.0.0`; LiteSpeed przekierowuje ruch do procesu.
- **HTTPS:** serwer stoi za pośrednikiem; przy `trustProxy: true` `req.protocol` = `https` (nagłówek `X-Forwarded-Proto`).
- **Baza:** MySQL na tym samym serwerze, host `127.0.0.1`. Baza próbna `u161817445_ngocloud` z osobnym użytkownikiem. Migracja przy starcie działa (`migrations: 1`).
- **`STORAGE_DIR`:** docelowo `/home/u161817445/domains/ivory-elk-740131.hostingersite.com/storage` (poza `public_html` i poza `hbuilds`, trwały między wdrożeniami). Zapis do niego sprawdzi kreator (krok 6).
- **Logi:** wyjście procesu widać w panelu (Node.js → logi) i przez API Hostingera.

**Problemy i rozwiązania**
1. 503 `ERR_REQUIRE_ASYNC_MODULE` → serwer bez top-level await.
2. `DATABASE_URL` nieczytany → ścieżki od katalogu aplikacji; komunikat błędu pokazuje, czy zmienna istnieje i jaki ma schemat (bez wartości).
3. `ER_ACCESS_DENIED_ERROR 1045` mimo poprawnie sparsowanego adresu → nowa baza i nowy użytkownik w hPanel. Przy błędzie startu serwer loguje przyczynę z MySQL (`code`, `errno`, `sqlState`, komunikat), bez adresu i hasła.

### Krok 2: szkielet aplikacji (2026-11-14)
- `src/server/config.ts`: zod; brak albo błędny `DATABASE_URL` lub `APP_SECRET` krótszy niż 32 bajty → tryb kreatora (serwer bez bazy, `/api/health` → `status: setup` z listą zmiennych do ustawienia, strona pokazuje komunikat). Testy: `config.test.ts`.
- `src/server/db/schema.ts`: `domainColumns()` (pola techniczne z zasady danych 1) i tabela `change_log` (migracja `0001`).
- `src/server/db/repo.ts`: jedyna warstwa zapisu — `insert`, `update` (tylko zmienione pola), `softDelete`, `restore`; pola techniczne, `version` (stara wersja → `VERSION_CONFLICT`), wpis do `change_log` w tej samej transakcji. Test `repo.test.ts` na tabeli `test_records` tworzonej tylko w teście (poza migracjami).
- `src/shared/errors.ts`: kody `NOT_FOUND`, `VERSION_CONFLICT` (polski komunikat w kliencie dojdzie z `i18n/pl.ts`).
- Logi Fastify: tylko metoda, wzorzec trasy (bez parametrów i zapytania), kod wyniku, czas. Bez IP, nagłówków i treści.
- **Odstępstwa:** id użytkownika w logach dojdzie z sesjami (krok 5). Zapis w `change_log` samych nazw pól dla `contact_identity` i `contact_sensitive` (zasada danych 8) dojdzie razem z tymi tabelami (ZADANIE_02).

### Krok 3: nagłówki, HTTPS, CSRF (2026-11-14)
- `src/server/security.ts`, rejestrowane w `buildApp` (działa też w trybie kreatora):
  - nagłówki z planu (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`) w hooku `onSend`, więc przy każdej odpowiedzi, także 404, odmowach i plikach statycznych;
  - bez HTTPS (`req.protocol` ≠ `https` przy `trustProxy`, adres inny niż `localhost`/`127.0.0.1`/`::1`) → 403 i strona „Ta aplikacja działa tylko przez HTTPS”, API nieobsługiwane;
  - każde żądanie zmieniające stan: `Origin` równy `protokół://host` żądania i `X-NGO-CRM: 1`, inaczej 403 `{ error: 'forbidden' }`.
- Build Vite bez wstawek inline (`assetsInlineLimit: 0`; `index.html` ma tylko `<script src>` i `<link href>`).
- Testy: `security.test.ts` (14 przypadków: nagłówki przy różnych odpowiedziach, HTTPS przez pośrednika, strona „tylko HTTPS”, localhost, brak/obcy/`http` Origin, brak nagłówka, poprawne żądanie, DELETE, GET bez wymagań).
- **Odstępstwa:**
  - `/api/health` odpowiada także bez HTTPS (bez danych, pokazuje `https: false`), żeby dało się zdiagnozować pośrednika i tryb kreatora;
  - sprawdzanie CSRF obejmuje wszystkie metody poza GET/HEAD/OPTIONS, nie tylko POST (żeby przyszła trasa PUT/DELETE nie ominęła ochrony);
  - adres aplikacji do porównania z `Origin` brany z żądania (`req.protocol` + `req.host`), bez nowej zmiennej środowiskowej.
- **Na Hostingerze:** wszystkie nagłówki obecne; konsola przeglądarki bez błędów CSP. LiteSpeed dokłada własny drugi nagłówek `Content-Security-Policy: upgrade-insecure-requests` (przeglądarka stosuje obie polityki, ta druga niczego nie zawęża). Żądania `http://` Hostinger przekierowuje 301 na `https://`, zanim dotrą do aplikacji, więc strona „tylko HTTPS” to zabezpieczenie zapasowe (np. na innym hostingu).
- Do kroku 8: lokalny krój Inter musi być plikiem (CSP nie ma `font-src data:`), a style tylko w plikach CSS (bez atrybutów `style` w HTML).

### Krok 4: kontrakt API i uprawnienia (2026-11-14)
- `src/shared/api.ts` (wzór: desktopowe `ipc.ts`): `apiMethods` = metoda → schemat zod, `roles` (wymagane, niepuste: `readonly [Role, ...Role[]]`, brak albo `[]` nie przechodzi typecheck — sprawdzone), `before2fa`; typy wyników w `ApiOutputs` (brak wpisu = błąd typów w obsłudze).
- Metody na start: `auth.me` (wszystkie role, także przed 2FA) i `system.info` (tylko `admin`: wersja, migracje). Kolejne dojdą z krokami 5–7.
- `src/server/rpc.ts`: `POST /api/rpc`, kolejność sesja → 2FA → rola → zod → obsługa. Wynik `{ ok, data }` albo `{ ok: false, code, message }` z kodem HTTP (401 `UNAUTHENTICATED`, 403 `TOTP_REQUIRED`/`FORBIDDEN`, 400 `VALIDATION`, 404, 409 `VERSION_CONFLICT`, 500 `UNKNOWN`). Nieznana metoda: bez sesji 401, z sesją 400.
- **Sesje przez wymienne `SessionProvider`** (decyzja MOC): na produkcji do kroku 5 `noSessions` (zawsze brak sesji → każda metoda 401); w testach podstawiana sesja. W kroku 5 wystarczy podać prawdziwe źródło do `buildApp`.
- RPC działa tylko z bazą (w trybie kreatora nie jest rejestrowane). CSRF i HTTPS z kroku 3 obejmują `/api/rpc` (hook `onRequest` przed strażnikiem).
- Logi RPC: metoda (tylko z kontraktu), id użytkownika, kod wyniku; nigdy parametry i wyniki. Błędy nieoczekiwane: nazwa, kod przyczyny i stos, bez treści błędu (może zawierać zapytanie z danymi).
- `src/shared/errors.ts`: kody jak wyżej; `src/client/i18n/pl.ts`: polskie komunikaty (m.in. „Ktoś zmienił ten rekord w międzyczasie…”).
- `src/client/lib/api.ts`: `call`, `ApiError`, `errorMessage`, `useLoad`, `useDataChanged` jak w desktopie; `fetch` z `X-NGO-CRM: 1` i `credentials: 'same-origin'`.
- Test `rpc.permissions.test.ts` (17): dla każdej metody bez sesji 401, bez 2FA 403 (poza `before2fa`), każda rola spoza listy 403, z listy przepuszczona; do tego kolejność rola przed zod, nieznana metoda, domyślne `noSessions`, CSRF na `/api/rpc`. Wymaga lokalnej bazy (jak `repo.test.ts`).
- **Odstępstwo:** `useLoad` bez odświeżania po zmianach z innych komputerów (to była synchronizacja desktopu).

### Krok 5: konta, logowanie, 2FA, sesje (2026-11-14)
Zrobiony etapami a)–e); decyzje bezpieczeństwa 1–26 są przy kroku 5 wyżej.
- **a)** tabele `users`, `auth_sessions`, `access_log` (migracja `0002`), sesje (`auth/sessions.ts`), baza testowa z zabezpieczeniem (`testDb.ts`, `TEST_DATABASE_URL`).
- **b)** kryptografia w przeglądarce (`src/client/crypto/`): PBKDF2 → HKDF, RSA-OAEP 3072, klucz organizacji, sloty, klucz odzyskiwania; tabele `org_keys`, `key_slots` (migracja `0003`).
- **c)** TOTP (`auth/totp.ts`) z blokadą ponownego użycia kodu, sekret szyfrowany kluczem z `APP_SECRET`, kod QR (`auth/qr.ts`).
- **d)** logowanie na serwerze (`auth/routes.ts`, `auth/password.ts`), blokady konta i IP (`auth/lockout.ts`), wylogowanie, `access_log`.
- **e)** ekrany (`src/client/screens/`): logowanie, konfiguracja 2FA, konto, zmiana hasła; metody `auth.*` w RPC (`auth/account.ts`); `npm run dev:account`.
- Testy: 180 (m.in. blokada po nieudanych logowaniach, wygaśnięcie sesji, błędny i powtórzony kod TOTP, nieprawidłowe ciasteczko, limit IP, zmiana hasła). Ekrany sprawdzone w przeglądarce lokalnie, także na zbudowanej aplikacji pod CSP (kod QR się ładuje, konsola bez błędów CSP).
- Na Hostingerze: scrypt z pełnymi parametrami działa (ok. 0,5 s na logowanie); produkcja nie ma żadnego konta (pierwsze założy kreator, krok 6).
- Poprawka przy okazji: `npm run dev` nie startował od kroku 4 (`tsx` nie znał aliasu `@shared`); `dev:server` dostał `--tsconfig tsconfig.server.json`.
- **Otwarte (do decyzji MOC): limit IP da się ominąć nagłówkiem `X-Forwarded-For`.** Test na produkcji: 22 nieudane próby z różnymi podrobionymi adresami w nagłówku nie wywołały blokady; bez nagłówka blokada zadziałała po 20 próbach. Przyczyna: `trustProxy: true` ufa całemu nagłówkowi, a LiteSpeed dopisuje prawdziwy adres na końcu, zamiast nadpisać nagłówek. Blokada konta (5 prób) działa niezależnie. Propozycja: `trustProxy: 1` (adres dopisany przez LiteSpeed) i ponowny test.
- Nie zrobione z opisu kroku 5: `settings` i `invitations` (powstaną z krokami 6 i 7, które ich używają).
