# CLAUDE.md — NGO_CRM Cloud

Ogólne zasady (praca tylko w `E:\AI_Projects`, pytanie przed zmianami, zasady kodowania) są w nadrzędnym `E:\AI_Projects\CLAUDE.md`. Ten plik zawiera tylko to, co dotyczy wersji chmurowej NGO_CRM.

## Projekt
- Wersja chmurowa (przeglądarkowa) lekkiego CRM dla polskich NGO (stowarzyszenia, fundacje, KGW). Ta sama domena co wersja desktopowa (`..\NGO_CRM`), inna architektura i zabezpieczenia.
- **Self-hosting przez organizację.** Każda organizacja sama wdraża i utrzymuje swoją instancję na hostingu zarządzanym z Node.js i MySQL/MariaDB (np. Hostinger). **MOC nie jest operatorem** i nie ma dostępu do danych.
- Open source (licencja do decyzji). Bez telemetrii, bez połączeń do serwerów autora.
- Przeczytaj przed pracą:
  - `NGO_CRM_CLOUD_KONCEPCJA.md` (architektura: rozdział 4, moduły: rozdział 7, kolejność prac: 4.9),
  - `NGO_CRM_CLOUD_BEZPIECZENSTWO.md` (wymagania i model kluczy, **obowiązuje w każdym zadaniu**),
  - `NGO_CRM_CLOUD_PROCESY_I_MODEL_DANYCH.md` (procesy i encje).
- Karta projektu: `..\Sejf\Projekty\NGO_CRM Cloud.md` (rzeczy wspólne z desktopem: `..\Sejf\Projekty\NGO_CRM.md`).
- Bieżące zadanie: plik `ZADANIE_XX_*.md` o najwyższym numerze.
- Wersja desktopowa jest źródłem logiki domenowej i interfejsu do przeniesienia (`..\NGO_CRM\src\shared`, `..\NGO_CRM\src\renderer`, `..\NGO_CRM\src\main\services`). Przenosimy przez kopiowanie i dostosowanie, bez wspólnego pakietu.

## Stack (propozycja, do potwierdzenia w ZADANIU_01, krok 0)
- **Klient:** Vite + React + TypeScript (strict), aplikacja jednostronicowa (SPA). Tailwind CSS + shadcn/ui. Szyfrowanie w przeglądarce przez **WebCrypto** (bez bibliotek kryptograficznych).
- **Serwer:** Node 22 LTS + **Fastify**, jeden proces serwuje API i zbudowany klient.
- **Baza:** MariaDB lokalnie, MySQL/MariaDB na hostingu. ORM **Drizzle** (`drizzle-orm/mysql2`), migracje SQL z `drizzle-kit`, uruchamiane przy starcie serwera.
- Walidacja: zod (wspólne schematy w `src/shared`). Testy: Vitest.
- **Bez dodatkowych bibliotek bez pytania MOC.** Każda zależność to powierzchnia ataku.

## Architektura aplikacji
- `src/server`: API, logowanie, sesje, uprawnienia, baza, pliki, kopie. Jedyne miejsce z dostępem do bazy i dysku.
- `src/client`: React. Rozmawia z serwerem tylko przez `src/client/lib/api.ts`. Tu żyją klucze do danych wrażliwych (tylko w pamięci karty).
- `src/shared`: kontrakt API, typy domeny, schematy zod, czysta logika (bez Node i bez DOM).
- **Jeden punkt wejścia API:** `POST /api/rpc` z `{ method, params }`. Każda metoda w kontrakcie (`src/shared/api.ts`) ma schemat zod **i listę ról, które mogą ją wywołać**. Serwer odrzuca wywołanie bez sesji, bez 2FA i bez uprawnienia. Test przechodzi po wszystkich metodach kontraktu i sprawdza, że żadna nie jest dostępna bez logowania ani dla złej roli.
- Wyjątki od RPC tylko dla: logowania, przesyłania i pobierania załączników (strumienie), pobierania kopii. Każdy z nich też za strażnikiem sesji i roli.
- **Warstwa zapisu (repozytorium)**: każdy zapis domenowy przechodzi przez jedną warstwę, która ustawia pola techniczne, sprawdza wersję rekordu i dopisuje wpis do `change_log`. Bez zapisów z pominięciem tej warstwy.

## Zasady danych (obowiązują w każdym zadaniu)
1. Każda tabela domenowa ma: `id` (UUID jako `char(36)`), `createdAt`, `updatedAt`, `updatedBy` (id użytkownika), `deletedAt`, `version` (liczba, blokada optymistyczna). **Bez** `deviceId`, zegarów HLC i tabel synchronizacji z desktopu: serwer jest jedynym źródłem prawdy.
2. Zapis ze starą `version` jest odrzucany komunikatem „Ktoś zmienił ten rekord w międzyczasie”. Bez cichego nadpisywania.
3. **Usuwanie = `deletedAt`**, widok Kosz pozwala przywrócić. **Jedyny wyjątek: anonimizacja osoby** (RODO), która fizycznie usuwa tożsamość i dane wrażliwe.
4. **Jedna baza kontaktów** (`contacts`, rodzaj `person` / `institution`) i **role** (`contact_roles`). **Tożsamość osobno** (`contact_identity`: imię, nazwisko, kontakt, adres), **dane wrażliwe osobno i zaszyfrowane w przeglądarce** (`contact_sensitive`). Działania, obecności, zadania i statystyki odwołują się tylko do `contacts.id`.
5. **Oś aktywności** (`activities`): uniwersalny wpis powiązany z osobami i opcjonalnie z działaniem.
6. Powiązania „z czymkolwiek”: `targetType` + `targetId`.
7. Znaczniki czasu: `datetime(3)` w UTC w bazie, ISO 8601 w API. Same daty: `date` (`YYYY-MM-DD`). Kwoty w groszach (`int`).
8. `change_log` dla tabel tożsamości i danych wrażliwych zapisuje **tylko nazwy zmienionych pól**, bez wartości.
9. **Żadnych danych osobowych w logach serwera**, same identyfikatory. **Żadnych prawdziwych danych osobowych** w danych demonstracyjnych i testach.
10. Serwer nigdy nie dostaje klucza do danych wrażliwych ani hasła użytkownika w postaci, z której da się ten klucz odtworzyć (model kluczy: `NGO_CRM_CLOUD_BEZPIECZENSTWO.md`, rozdział 5).

## Bezpieczeństwo (skrót; pełne wymagania w `NGO_CRM_CLOUD_BEZPIECZENSTWO.md`)
- Bez HTTPS aplikacja odmawia pracy (poza `localhost` w trybie deweloperskim).
- 2FA obowiązkowe dla wszystkich (TOTP; klucze dostępu później). Bez 2FA sesja nie ma dostępu do niczego poza konfiguracją 2FA.
- Sesja: losowy token w ciasteczku `httpOnly`, `Secure`, `SameSite=Strict`; w bazie tylko skrót. Wylogowanie po bezczynności, „wyloguj wszędzie”.
- Ochrona CSRF: `SameSite=Strict` + sprawdzenie nagłówka `Origin` + własny nagłówek przy każdym `POST`.
- Ścisła CSP bez `unsafe-inline` i `unsafe-eval`, HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`.
- Zapytania tylko przez Drizzle, bez sklejania SQL. Walidacja zod każdego wejścia.
- Sekrety tylko w zmiennych środowiskowych (`.env` lokalnie, panel hostingu na serwerze), nigdy w repozytorium. Wzór: `.env.example`.
- `npm audit` przed każdym wydaniem. Lockfile w repozytorium.

## Konwencje
- **Interfejs wyłącznie po polsku.** Kod, nazwy plików, tabel i zmiennych po angielsku.
- Daty w UI `dd.mm.rrrr`, godziny `HH:mm`, kwoty w PLN w formacie `pl-PL`.
- Widoki projektowane pod laptopa (od 1280 px szerokości), czytelne od 1024 px. Bez wersji mobilnej na start.
- Statusy i typy jako `varchar` z unią typów w TS (nie `enum` bazy).
- Teksty interfejsu w jednym miejscu (`src/client/i18n/pl.ts`).
- Wygląd jak w wersji desktopowej (makieta zaakceptowana, `..\NGO_CRM\docs\makieta_ui\`).

## Słowniczek domeny (UI ↔ kod)
| UI (PL) | Kod (EN) |
|---|---|
| Osoba / Instytucja | `Contact` (`kind`: `person` / `institution`) |
| Dane osoby (imię, kontakt) | `ContactIdentity` |
| Dane wrażliwe | `ContactSensitive` (zaszyfrowane w przeglądarce) |
| Rola | `ContactRole` |
| Powiązanie | `Relationship` |
| Zgoda | `Consent` |
| Aktywność / wpis na osi | `Activity` |
| Działanie | `Action` |
| Zajęcia / termin działania | `Session` (tabela `action_sessions`, żeby nie mylić z sesją logowania) |
| Uczestnik działania | `ActionParticipant` |
| Obecność | `Attendance` |
| Temat szkolenia | `Topic` |
| Zadanie | `Task` |
| Załącznik | `Attachment` (zaszyfrowany w przeglądarce) |
| Użytkownik programu | `User` |
| Sesja logowania | `AuthSession` |
| Klucz organizacji (do danych wrażliwych) | `OrgKey` |
| Dostęp do klucza (slot) | `KeySlot` |
| Dziennik dostępu | `AccessLog` |
| Dziennik zmian (techniczne) | `ChangeLog` |
| Ustawienia | `Settings` |

## Typy działań i „w ramach czego”
- `type`: `training` szkolenie · `workshop` warsztat · `event` wydarzenie · `meeting` spotkanie · `fundraiser` zbiórka · `other` inne.
- `framework`: `project` projekt · `statutory_free` działalność statutowa nieodpłatna · `statutory_paid` działalność statutowa odpłatna · `business` działalność gospodarcza.

## Role kontaktów
`participant` uczestnik · `volunteer` wolontariusz · `donor` darczyńca · `member` członek · `partner` partner · `trainer` trener · `staff` pracownik · `other` inna.

## Role użytkowników programu
`admin` administrator · `staff` pracownik · `readonly` tylko odczyt. Dostęp do danych wrażliwych to osobne uprawnienie (slot klucza), nie rola.

## Polecenia (powstaną w ZADANIU_01)
- `npm run dev`: serwer i klient w trybie deweloperskim (lokalna MariaDB musi działać)
- `npm test`: testy (Vitest), w tym test uprawnień wszystkich metod API
- `npm run db:generate`: nowa migracja ze schematu Drizzle (`drizzle/`, uruchamiane przy starcie serwera)
- `npm run typecheck`: sprawdzenie typów
- `npm run build`: typecheck + build klienta i serwera
- `npm start`: start zbudowanej aplikacji (tak uruchamia ją hosting)
- `npm run dev:account`: konto próbne `admin@lokalnie.test` tylko w lokalnej bazie (hasło wypisane raz; zakłada też ustawienia organizacji)
- `npm run dev:demo`: fikcyjne dane demonstracyjne tylko w lokalnej bazie (najpierw `dev:account`; czyści dane domenowe)

## Uwagi z iV_CRM (ten sam hosting)
- Hostinger: każde wdrożenie podmienia folder aplikacji → załączniki i kopie w `STORAGE_DIR` poza nim.
- Host bazy `127.0.0.1`, nie `localhost`. Migracje przy starcie albo w poleceniu budowania.
- Brak SSH do aplikacji Node: pierwsze konto przez jednorazowy kreator z `SETUP_TOKEN`.
- Pliki konfiguracyjne jako `.mjs` (Hostinger nie wczytał `next.config.ts`). Limit żądania 120 s.
