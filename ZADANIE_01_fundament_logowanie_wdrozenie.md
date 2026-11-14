# ZADANIE 01 — Fundament: próbne wdrożenie, logowanie, klucze, role

Status: do realizacji (decyzje D1–D6 do potwierdzenia w Kroku 0) · Kontekst: `CLAUDE.md`, `NGO_CRM_CLOUD_KONCEPCJA.md` (4.1–4.3, 4.7), `NGO_CRM_CLOUD_BEZPIECZENSTWO.md` (rozdziały 4 i 5), `NGO_CRM_CLOUD_PROCESY_I_MODEL_DANYCH.md` (2.2) · Wzór: iV_CRM `ZADANIE_02_logowanie_i_wdrozenie.md` i `lib/auth/`

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

## Krok 6: kreator pierwszego uruchomienia
Działa tylko, gdy w bazie nie ma żadnego użytkownika **i** podano poprawny `SETUP_TOKEN`. Po zakończeniu wyłączony na stałe (także gdy `SETUP_TOKEN` zostanie w panelu; panel „Stan bezpieczeństwa” w ZADANIU_04 przypomni o jego usunięciu).
1. Sprawdzenie: HTTPS, połączenie z bazą, migracje, `APP_SECRET` (gdy brak: pokazuje wygenerowaną wartość do wklejenia w panelu i kończy), zapisywalny `STORAGE_DIR` (próbny plik).
2. Organizacja: nazwa, profil (KGW / darczyńcy / projekty / własny — jak w desktopie).
3. Administrator: imię, e-mail, hasło (min. 12 znaków, siła sprawdzana w przeglądarce), od razu 2FA.
4. Klucz organizacji i klucz odzyskiwania: pokazany raz, do wydruku (strona do druku z przeglądarki) i z potwierdzeniem „wpisz 4 ostatnie znaki”. Tekst wprost: „Bez hasła osoby z dostępem i bez tego klucza danych wrażliwych nie da się odzyskać. Autor programu też ich nie odzyska.”
5. Ekran końcowy: lista kontrolna (usuń `SETUP_TOKEN` z panelu, schowaj wydruk klucza, włącz kopie hostingu).

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
_(uzupełnić po realizacji: wynik kroku 1 na Hostingerze, problemy i rozwiązania, odstępstwa od planu)_
