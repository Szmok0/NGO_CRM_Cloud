# ZADANIE 04 — Utrzymanie

Status: rozpisane 2026-11-15, decyzje D1–D14 zaakceptowane co do kierunku przez MOC 2026-11-15 (szczegóły do potwierdzenia w kroku 0) · Kontekst: `CLAUDE.md`, `NGO_CRM_CLOUD_KONCEPCJA.md` (4.5, 4.9), `NGO_CRM_CLOUD_BEZPIECZENSTWO.md` (rozdziały 2–4 i 6), `NGO_CRM_CLOUD_PROCESY_I_MODEL_DANYCH.md` (tabele `backups`, `erased_contacts`, `settings`), ZADANIE_03 (zrobione 2026-11-15, ostatni commit `45bf8d8`, otwarte sprawy w „Wyniku”)

## Zasada nadrzędna (MOC, 2026-11-15)
**Małe organizacje bez wiedzy technicznej muszą sobie z tym poradzić same.** Bez nowych haseł, kluczy, wydruków i zmiennych do ustawiania. Co się da, dzieje się samo. Każdy komunikat mówi zwykłym językiem, co się stało i co kliknąć. Jeśli jakieś rozwiązanie wymaga od organizacji wiedzy technicznej, szukamy prostszego albo pytamy MOC.

## Cel
Organizacja ma kopie bez pamiętania o nich: program robi je sam, przypomina o pobraniu na komputer i pozwala jednym kliknięciem sprawdzić, że kopia da się odtworzyć. Po awarii administrator odtwarza wszystko w kreatorze, logując się jak zwykle.

Administrator widzi w jednym miejscu, czy wszystko jest w porządku („Stan bezpieczeństwa”): wersję programu, kopie, 2FA, dostęp do danych wrażliwych, osoby po okresie przechowywania. Wie, kiedy jest nowa wersja i jak ją zainstalować.

Organizacja dostaje instrukcję wdrożenia i listę kontrolną bezpieczeństwa napisane dla osoby nietechnicznej. Domykamy też drobne błędy z ZADANIA_03.

## Poza zakresem (nie rób)
- Kopie poza serwerem wysyłane automatycznie (e-mail, chmura, FTP): organizacja pobiera kopię przyciskiem.
- Automatyczna anonimizacja po okresie przechowywania (tylko przypomnienie i przycisk).
- Aktualizacja programu z poziomu aplikacji (robi ją GitHub i Hostinger).
- Pola własne, profile, moduły z ZADANIA_05 i dalej.
- Przegląd bezpieczeństwa całości przed pilotażem (osobno, po tym zadaniu).

## Krok 0: przed kodem
1. Przeczytaj: `src/server/services/anonymize.ts` (`applyErasures`, `removeFiles`), `src/server/auth/setup.ts` i `setupRoutes.ts` (kreator, `SETUP_TOKEN`), `src/server/attachmentRoutes.ts` (strumienie, `STORAGE_DIR`), `src/server/db/schema.ts`, `src/server/services/overview.ts`, `src/server/services/settings.ts`, `src/client/crypto/*` (sloty, RSA-OAEP, wyprowadzanie `wrapKey`), `src/client/lib/keyring.ts`, `.env.example`.
2. **Stan kodu, który wpływa na zadanie:**
   - nie ma tabeli `backups` ani żadnego kodu kopii,
   - `settings.retentionMonths` jest w schemacie, bez ekranu i bez logiki,
   - `applyErasures` istnieje i jest idempotentne, nikt go nie wywołuje,
   - `erased_contacts` leży w tej samej bazie co reszta, więc kopia sprzed anonimizacji nie zna późniejszych usunięć (D5),
   - wersja programu to tylko `package.json` (`0.1.0`), nigdzie niewyświetlana,
   - Hostinger: brak crona i SSH dla aplikacji Node, limit żądania 120 s, każde wdrożenie podmienia folder aplikacji (dlatego wszystko trwałe w `STORAGE_DIR`).
3. **Decyzje (kierunek zaakceptowany przez MOC 2026-11-15; doprecyzowania przedstaw MOC przed krokiem 1):**

   **Kopie**
   - **D1. Kopie robią się same:**
     - raz na dobę; serwer co godzinę sprawdza (timer w procesie), czy od ostatniej udanej kopii minęła doba; pierwsze sprawdzenie zaraz po starcie,
     - przycisk „Zrób kopię teraz” (`admin`),
     - pliki w `STORAGE_DIR/backups/`, rotacja: 7 ostatnich dziennych + 4 tygodniowe (najnowsza z każdego tygodnia); starsze usuwane automatycznie,
     - blokada przed dwiema kopiami naraz (wiersz w `backups` ze statusem `running`, przeterminowany po 30 min),
     - bez `STORAGE_DIR` kopie nie powstają, a panel pokazuje to na czerwono z instrukcją.
   - **D2. Zawartość kopii:** wszystkie tabele bazy (z `users`, `key_slots`, `org_keys`, `access_log`, `erased_contacts`) oraz pliki załączników (już zaszyfrowane w przeglądarce). Poza kopią: sesje logowania, tabela `backups`. Format własny, bez nowych bibliotek: nagłówek JSON + segmenty (tabele jako JSON Lines, pliki jako bajty), kompresja `node:zlib` (gzip). W nagłówku: wersja formatu, wersja programu, liczba migracji, data, liczby wierszy w tabelach i plików, suma SHA-256 treści.
   - **D3. Kopię otwiera zwykły login i hasło administratora (bez nowego sekretu):**
     - serwer losuje klucz kopii (AES-GCM), szyfruje treść segmentami (np. po 4 MB, każdy z własnym IV i numerem segmentu w AAD), żeby przeglądarka mogła czytać duży plik kawałkami,
     - klucz kopii zawinięty kluczem publicznym (RSA-OAEP) każdego aktywnego administratora z kluczem publicznym, tak jak sloty,
     - w nagłówku przy każdym administratorze: skrót e-maila (nie jawny e-mail), parametry wyprowadzania `wrapKey` (sól itd.) i zawinięty klucz prywatny w postaci z dnia kopii,
     - otwarcie: przeglądarka z e-maila i hasła liczy `wrapKey`, odwija klucz prywatny, potem klucz kopii; nic nie idzie do serwera przy teście (D4),
     - ograniczenie opisane w instrukcji jednym zdaniem: po zmianie hasła starszą kopię otwiera hasło z dnia kopii; po każdej zmianie hasła administratora program od razu robi nową kopię,
     - dane wrażliwe w kopii pozostają zaszyfrowane kluczem organizacji (podwójnie), serwer nie dostaje nic nowego.
   - **D4. Pobranie i „Sprawdź kopię”:**
     - lista kopii w ustawieniach (data, rozmiar, „pobrana”, „sprawdzona”); pobranie strumieniem poza RPC (`GET /api/backups/:id`, za strażnikiem sesji, 2FA i roli `admin`), wpis `backup_download` w dzienniku dostępu,
     - przypomnienie (baner u administratora i panel): „Pobierz kopię na swój komputer” po 7 dniach od ostatniego pobrania,
     - „Sprawdź kopię”: administrator wskazuje plik z dysku i podaje hasło; przeglądarka czyta plik kawałkami, odszyfrowuje, sprawdza sumę, liczby wierszy i plików, i pokazuje wynik po ludzku („Kopia z 14.11.2026: 230 osób, 41 działań, 12 dokumentów. Da się ją odtworzyć.”); wynik zapisany w `backups.restoreTestedAt/restoreTestResult` (bez treści),
     - serwer nie dostaje klucza kopii przy teście.
   - **D5. Usunięcia z anonimizacji przeżywają odtworzenie:** lista `erased_contacts` zapisywana także jako plik `STORAGE_DIR/erased_contacts.json` (same identyfikatory i daty) przy każdej anonimizacji. Odtworzenie łączy listę z kopii z listą z pliku (jeśli jest) i wywołuje `applyErasures`. Instrukcja: przy odtwarzaniu na nowym serwerze bez starego `STORAGE_DIR` usunięcia późniejsze niż kopia trzeba powtórzyć (program pokaże ostrzeżenie).
   - **D6. Odtworzenie w kreatorze pierwszego uruchomienia:**
     - tylko na pustej bazie (świeża instalacja albo po awarii), za `SETUP_TOKEN` jak dziś,
     - kreator ma drugą drogę: „Odtwórz z kopii” → plik → e-mail i hasło administratora z dnia kopii,
     - przeglądarka odwija klucz kopii i przekazuje go serwerowi razem z plikiem (serwer i tak trzyma te dane w bazie; klucz kopii dotyczy tylko tego pliku),
     - plik wysyłany kawałkami (limit 120 s na żądanie Hostingera), serwer sprawdza sumę, wgrywa w jednej transakcji, kładzie pliki załączników, nakłada usunięcia (D5), unieważnia wszystkie sesje,
     - po odtworzeniu wszyscy logują się jak wcześniej (te same hasła, 2FA i dostęp do danych wrażliwych),
     - kopia z nowszą liczbą migracji niż program → odmowa z komunikatem „Najpierw zaktualizuj program”; starsza → migracje po wgraniu.
   - **D7. Kopia do pomocy technicznej:** przycisk (`admin`), osobny plik do pobrania, niezaszyfrowany, z ostrzeżeniem:
     - tożsamość zamieniona na „Osoba 17” / „Instytucja 3” (bez e-maili, telefonów, adresów, tagów),
     - bez `contact_sensitive`, załączników, sesji, slotów, kluczy, dziennika dostępu; użytkownicy jako „Użytkownik 2”, bez haseł i TOTP,
     - treść osi, zadań i notatek wyczyszczona (może zawierać nazwiska); zostają typy, daty, liczby,
     - test „Kopia do pomocy” z bezpieczeństwa (rozdział 6): fikcyjne dane demo → szukanie imion, nazwisk, e-maili, telefonów w pliku; zaliczony, gdy nic nie znaleziono.

   **Utrzymanie**
   - **D8. Panel „Stan bezpieczeństwa”** (`admin`, pierwsza pozycja w Ustawieniach; skrót na „Dziś”, gdy coś jest czerwone):
     - lista spraw, każda z kolorem (zielony / żółty / czerwony), jednym zdaniem „co to znaczy” i przyciskiem „co zrobić”,
     - sprawy: wersja programu (D9), HTTPS i `STORAGE_DIR`, ostatnia kopia (czerwone > 2 dni), ostatnie pobranie (żółte > 7 dni), ostatnie sprawdzenie kopii (żółte > 30 dni), konta bez 2FA, kto ma dostęp do danych wrażliwych, czy zmiana klucza została dokończona, osoby po okresie przechowywania (D10),
     - bez danych osobowych poza nazwami kont użytkowników.
   - **D9. Nowa wersja:**
     - wersja z `package.json` i data wydania widoczne w stopce ustawień i w panelu,
     - serwer raz na dobę pyta API wydań na GitHubie (repozytorium główne projektu, adres w stałej w kodzie), bez żadnych danych organizacji i bez identyfikatorów; wyłącznik w ustawieniach, domyślnie włączony, opisany w instrukcji,
     - panel: „Jest nowa wersja 0.2.0” + link do opisu zmian + instrukcja w trzech krokach (GitHub → „Sync fork” → Hostinger wdroży sam),
     - wydanie oznaczone jako poprawka bezpieczeństwa (słowo w tytule wydania) → czerwone,
     - brak połączenia z GitHubem nie jest błędem (szare „nie udało się sprawdzić”).
   - **D10. Okresy przechowywania:**
     - ustawienie „Ile miesięcy przechowywać dane osób bez aktywności” (puste = wyłączone, podpowiedź 24),
     - lista osób bez aktywności, udziału, obecności i zadań dłużej niż okres (bez aktywnej roli `member`, `staff`, `donor` — do potwierdzenia z MOC),
     - przy każdej osobie „Anonimizuj” (istniejące okno z ZADANIA_03) albo „Zostaw jeszcze na rok” (data odłożenia na osobie),
     - nic nie dzieje się automatycznie.

   **Dokumenty i poprawki**
   - **D11. Dokumenty dla organizacji** w `docs/` (po polsku, dla osoby nietechnicznej, krótkie zdania, krok po kroku):
     - `INSTRUKCJA_WDROZENIA.md`: Hostinger od zera (strona Node, baza, zmienne, `STORAGE_DIR`, GitHub i fork, kreator, 2FA, klucz odzyskiwania, pierwsze pobranie i sprawdzenie kopii), aktualizacja, odtworzenie po awarii,
     - `LISTA_KONTROLNA.md`: jedna strona do odhaczania (start i co miesiąc), podział odpowiedzialności (bezpieczeństwo, rozdział 3), umowy powierzenia, kto trzyma klucz odzyskiwania, co zrobić przy incydencie (procedura w punktach),
     - `SRODKI_TECHNICZNE.md`: opis zabezpieczeń do rejestru czynności i DPIA (do wklejenia),
     - bez prawniczych rozstrzygnięć (rozdział 8 bezpieczeństwa: do konsultacji z prawnikiem; zaznaczyć).
   - **D12. Poprawki z ZADANIA_03:**
     - kanban Zadań: karta zadania z wyczyszczonym tytułem pokazuje „(treść usunięta)”,
     - po „Odzyskaj dostęp” lista użytkowników i dziennik odświeżają się same,
     - po odświeżeniu strony konto bez slotu widzi od razu „brak dostępu” (pracownik) albo „Odzyskaj dostęp” (administrator), nie „Odblokuj”,
     - wyszukiwarka w górnym pasku: znaleźć przyczynę braku wyniku dla nazwiska i naprawić (test na regresję).
   - **D13. Logi serwera:** przegląd pełnych wierszy logu w panelu Hostingera (kryterium 13 z ZADANIA_03) przy wdrożeniu w kroku 7; zdarzenia kopii logowane tylko jako identyfikatory, rozmiary i czasy.
   - **D14. Bez nowych bibliotek:** `node:zlib`, `node:crypto`, `node:stream`, WebCrypto. Dane w testach i demo wyłącznie fikcyjne.
4. Przedstaw MOC krótki plan kroku 1, listę plików i doprecyzowania decyzji (zwłaszcza D3, D6, D10). **Czekaj na akceptację.**

## Zasady (dotyczą każdego kroku)
- **Zasada nadrzędna** (wyżej): każdy ekran i komunikat sprawdzony pytaniem „czy poradzi sobie z tym osoba z KGW bez informatyka?”.
- **Serwer nie dostaje klucza organizacji ani hasła.** Klucz kopii trafia do serwera tylko przy odtworzeniu (D6).
- **Pliki kopii tylko w `STORAGE_DIR`**, poza folderem aplikacji i `public_html`. Pobieranie zawsze `Content-Disposition: attachment`, `no-store`.
- **Dziennik dostępu:** `backup_create` (ręczna), `backup_download`, `backup_verify`, `backup_restore`, `support_copy`, zmiana ustawień przechowywania i sprawdzania wersji. Tylko identyfikatory.
- **Logi serwera:** bez danych osobowych, nazw plików kopii z danymi i treści.
- **CSP:** bez nowych wyjątków; zapytanie o wersję robi serwer, nie przeglądarka.
- **Teksty** w `src/client/i18n/pl.ts`.
- **Każdy krok:** a) serwer i testy, b) ekrany i sprawdzenie w przeglądarce na zbudowanej aplikacji pod CSP. Po każdym etapie commit i krótki wpis w „Wyniku”.

## Krok 1: kopie (powstawanie, rotacja, pobieranie)
- a) Serwer i testy: tabela `backups` (migracja), format kopii (D2) i szyfrowanie segmentami (D3), timer i blokada (D1), rotacja, RPC `backups.list` / `backups.create`, trasa pobierania, plik `erased_contacts.json` przy anonimizacji (D5), nowa kopia po zmianie hasła administratora, test uprawnień, test „w pliku kopii nie ma jawnego nazwiska” (fikcyjna osoba).
- b) Ekrany: lista kopii w Ustawieniach, „Zrób kopię teraz”, pobranie, baner przypomnienia.

## Krok 2: „Sprawdź kopię” w przeglądarce
- a) Moduł w `src/client/crypto` czytający kopię kawałkami (działa też w Node, jak w ZADANIU_03), RPC zapisu wyniku testu; testy: dobra kopia, złe hasło, uszkodzony plik, kopia sprzed zmiany hasła.
- b) Okno „Sprawdź kopię” z wynikiem po ludzku.

## Krok 3: odtworzenie w kreatorze
- a) Trasy kreatora dla odtworzenia (kawałki, suma, transakcja, pliki, `applyErasures`, migracje, unieważnienie sesji), odmowa na niepustej bazie i dla nowszej kopii; test pełnego cyklu: dane → kopia → pusta baza → odtworzenie → logowanie tym samym hasłem → odsłonięcie danych wrażliwych → usunięcia z D5 nałożone.
- b) Ścieżka „Odtwórz z kopii” w kreatorze.

## Krok 4: panel „Stan bezpieczeństwa” i nowa wersja
- a) RPC `security.status` (jedno wywołanie, wszystkie sprawy z D8), sprawdzanie wersji (D9) z wyłącznikiem, testy (w tym brak sieci).
- b) Panel, skrót na „Dziś”, stopka z wersją.

## Krok 5: okresy przechowywania i kopia do pomocy
- a) Lista osób po okresie (D10), „Zostaw jeszcze na rok”, kopia do pomocy technicznej (D7) z testem „Kopia do pomocy”.
- b) Ustawienie okresu, lista w panelu, przycisk kopii do pomocy z ostrzeżeniem.

## Krok 6: poprawki z ZADANIA_03 i dokumenty
- a) Poprawki z D12 (z testami tam, gdzie się da), dokumenty z D11.
- b) Sprawdzenie poprawek w przeglądarce; MOC czyta dokumenty pod kątem „czy zrozumie to osoba nietechniczna”.

## Krok 7: scenariusz akceptacji, wdrożenie
- `src/server/acceptance.test.ts` rozszerzony o kopie, sprawdzenie, odtworzenie, przechowywanie i kopię do pomocy.
- `npm audit`.
- Wdrożenie na Hostinger po zgodzie MOC, przeklikanie kryteriów na instancji próbnej (tylko dane fikcyjne), przegląd pełnych wierszy logu w panelu (D13). Odtworzenie przeklikane na lokalnej pustej bazie (na produkcji tylko „Sprawdź kopię”, chyba że MOC zdecyduje inaczej).

## Kryteria akceptacji (scenariusz do przeklikania)
1. `npm run typecheck`, `npm test` i `npm run build` przechodzą. Test uprawnień obejmuje wszystkie nowe metody i trasy.
2. Po wdrożeniu kopia powstaje sama w ciągu godziny, potem raz na dobę. Rotacja zostawia 7 dziennych i 4 tygodniowe. „Zrób kopię teraz” działa.
3. W pliku kopii nie ma jawnego nazwiska fikcyjnej osoby ani danych wrażliwych.
4. Pobieram kopię jednym kliknięciem. Po 7 dniach bez pobrania widzę przypomnienie.
5. „Sprawdź kopię” z moim zwykłym hasłem pokazuje wynik po ludzku. Złe hasło i uszkodzony plik dają zrozumiały komunikat.
6. Na pustej bazie odtwarzam kopię w kreatorze moim loginem i hasłem. Wszyscy logują się jak wcześniej, dane wrażliwe i dokumenty się otwierają, osoba zanonimizowana po zrobieniu kopii pozostaje zanonimizowana.
7. Panel „Stan bezpieczeństwa” pokazuje wszystkie sprawy z D8 z kolorem i przyciskiem „co zrobić”. Czerwone sprawy widać też na „Dziś”.
8. Panel pokazuje wersję programu i informację o nowej wersji z instrukcją. Po wyłączeniu sprawdzania serwer nie łączy się z GitHubem.
9. Po ustawieniu okresu przechowywania widzę osoby bez aktywności i mogę je zanonimizować albo odłożyć.
10. Kopia do pomocy technicznej nie zawiera imion, nazwisk, e-maili, telefonów ani treści notatek; aplikacja działa na niej normalnie (test „Kopia do pomocy”).
11. Poprawki z D12 działają (kanban, odświeżanie, „brak dostępu” po odświeżeniu, wyszukiwarka).
12. Instrukcja wdrożenia i lista kontrolna są zrozumiałe dla osoby nietechnicznej (ocena MOC).
13. Na Hostingerze wszystko działa po HTTPS, konsola jest bez błędów CSP, a pełne wiersze logu serwera nie zawierają danych osobowych.
14. Commit i `git push` po akceptacji MOC.

## Po zakończeniu
Krótkie podsumowanie dla MOC w „Wyniku”:
- co zrobiono,
- odstępstwa od opisu i powody,
- co trzeba przenieść do desktopu (bezpieczeństwo, rozdział 9),
- otwarte sprawy na ZADANIE_05.

Nie aktualizuj Sejfu bez zgody MOC.

## Wynik
_(uzupełniane po każdym etapie)_

### Krok 0 (2026-11-15) — decyzje MOC
Plan kroku 1 zaakceptowany z poprawkami względem opisu D1–D10:
- **D3:** w nagłówku kopii przy administratorze jest też `userId` (potrzebny do odwinięcia klucza prywatnego: wchodzi do jego AAD). Zamiast globalnej sumy SHA-256 w przeglądarce (WebCrypto nie liczy jej strumieniowo): tagi GCM segmentów z numerem i flagą „ostatni” w AAD; globalną sumę liczy serwer (`backups.sha256`).
- **D6:** `APP_SECRET` (szyfruje sekrety TOTP) trzeba zachować; trafia do instrukcji jako rzecz do zapisania. Bez niego po odtworzeniu 2FA nie działa (do rozstrzygnięcia w kroku 3: sam komunikat czy reset 2FA).
- **D7:** kopia do pomocy musi też czyścić `change_log` (zawiera wartości pól) i wolny tekst w `actions`, `topics`, `relationships.note`, `consents`, `contact_roles.note`, `action_participants.note`, `action_sessions.note`, `activities.form`.
- **D10:** wyłączenie z listy osób z rolą `member`, `staff`, `donor` potwierdzone. `invitations` poza kopią.

### Krok 1, etap a (2026-11-15) — serwer i testy kopii
Zrobione: tabela `backups` (migracja 0013), format pliku (`src/shared/backupFormat.ts`), zapis i szyfrowanie segmentami (`services/backupExport.ts`), tworzenie w tle, blokada, rotacja 7 dób + 4 tygodnie, lista, harmonogram i timer godzinowy (`services/backups.ts`), pobieranie `GET /api/backups/:id` (`backupRoutes.ts`), RPC `backups.list` / `backups.create`, wpisy `backup_create` i `backup_download` w dzienniku, `erased_contacts.json` (D5) po kopii i po anonimizacji, nowa kopia po zmianie hasła administratora. 14 nowych testów (odszyfrowanie niezależnym kodem, wykrywanie zmiany/obcięcia/przestawienia segmentów, blokada, rotacja, harmonogram, pobieranie i role); całość 836/836, typecheck czysty.
Odstępstwa i uwagi:
- Zaproszenia (`invitations`) i sesje poza kopią. Klucz kopii zawijany tylko aktywnym administratorom z kompletem kluczy; bez takiego administratora kopia kończy się statusem `failed`.
- Nowa kopia po zmianie hasła powstaje tylko po `auth.changePassword`; po przyjęciu zaproszenia administratora (pierwsze klucze) dopiero z kolejną kopią automatyczną (do rozważenia w kroku 4).
- Wiersze rotowanych kopii zostają ze statusem `removed` (historia pobrań dla przypomnienia z kroku 2).
- Kopia czytana w jednej transakcji z migawką; wymaga InnoDB na hostingu (do sprawdzenia przy wdrożeniu, krok 7).
- Do przejrzenia przez MOC (najlepiej Opus): `backupExport.ts` (zawijanie klucza RSA-OAEP z etykietą, AAD segmentów) i `backupRoutes.ts` (rola `admin`, `no-store`).
Następny etap: krok 2 (ekran kopii, „Sprawdź kopię” w przeglądarce).

### Krok 1, etap b (2026-11-15) — ekrany kopii
Zrobione: karta „Kopie zapasowe” w Ustawieniach (administrator): lista (kiedy, rodzaj, rozmiar, stan, pobrana, sprawdzona), „Zrób kopię teraz” (odświeżanie co 2 s, póki kopia trwa), pobranie zwykłym linkiem do strumienia (bez ładowania pliku do pamięci przeglądarki), komunikat na czerwono bez `STORAGE_DIR`, komunikat po nieudanej kopii. Baner przypomnienia „Pobierz kopię na swój komputer” w układzie aplikacji (poza samymi Ustawieniami), liczony po stronie serwera (`downloadDue`: ponad 7 dni od ostatniego pobrania albo od pierwszej kopii; pobranie liczone także po kopiach usuniętych rotacją).
Zmiana kontraktu: `backups.list` zwraca `{ items, lastDownloadedAt, downloadDue }`.
Sprawdzone w przeglądarce na zbudowanej aplikacji (lokalnie, baza testowa, konto próbne): logowanie z 2FA, ręczna kopia, lista, pobranie (znacznik „Pobrana” i wpis w logu serwera), brak naruszeń CSP w konsoli. Baner przypomnienia sprawdzony tylko testem serwera (`downloadDue`), nie przeklikany.
Testy: 837/837, typecheck czysty.
Następny etap: krok 2 („Sprawdź kopię” w przeglądarce).

### Krok 2 (2026-11-15) — „Sprawdź kopię”
Zrobione: moduł `src/client/crypto/backupRead.ts` (nagłówek, otwarcie klucza kopii e-mailem i hasłem, czytanie segmentów kawałkami przez `Blob.slice`, `DecompressionStream`, parser ramek; `verifyBackup` porównuje liczby wierszy i plików z zestawieniem na końcu pliku; `readBackup`/`openBackup` (z opcją wyeksportowania klucza) gotowe pod krok 3). Kody błędów: `not_backup`, `newer_format`, `no_account`, `wrong_password`, `corrupt`. RPC `backups.markTested` (admin; kopię wskazuje `createdAt` z nagłówka = `startedAt`; plik z innego serwera lub usunięta kopia → `matched: false`, bez zapisu; zapisuje tylko udane sprawdzenia; wpis `backup_verify`). Okno „Sprawdź kopię” w karcie kopii (plik, e-mail wstępnie wypełniony, hasło, wynik „Kopia z 15.11.2026: 230 osób, 41 działań, 12 dokumentów. Da się ją odtworzyć.”, komunikaty błędów po polsku).
Testy (`backupVerify.test.ts`, prawdziwe klucze i prawdziwy plik z serwera): dobra kopia, złe hasło i e-mail, uszkodzenia (bajt, obcięcie, śmieci, nagłówek), kopia sprzed zmiany hasła, nowszy format, uprawnienia i zapis wyniku. Całość 848/848, typecheck czysty.
Uwagi: przeklikanie w przeglądarce (CSP, `DecompressionStream`) razem z krokiem 3b. Format nie zawiera id kopii, stąd dopasowanie po dacie.

### Krok 3 (2026-11-15) — odtworzenie w kreatorze
Zrobione (etap a, serwer): `services/backupRestore.ts` (pusta baza wymagana, odmowa dla nowszej kopii: „Najpierw zaktualizuj program”, odczyt segmentów i gunzip strumieniowo, jedna transakcja z wyłączonym sprawdzaniem kluczy obcych na czas wgrywania, pliki załączników najpierw do folderu roboczego i na miejsce dopiero po zatwierdzeniu bazy, usunięcia z D5 z pliku `erased_contacts.json` + `applyErasures`, wpis `backup_restore`). Trasy kreatora za `SETUP_TOKEN`: `/api/setup/restore/begin`, `/chunk` (surowe bajty, kawałki po kolei, do 4 MB), `/finish` (klucz kopii, odtworzenie, sprzątanie pliku roboczego). Sesje poza kopią.
Rozstrzygnięcie APP_SECRET: po odtworzeniu serwer próbuje odczytać sekret 2FA obecnym `APP_SECRET`; jeśli się nie da, **sam czyści 2FA wszystkich kont** (przy logowaniu każdy ustawia je od nowa, ekran już istnieje) i mówi o tym w wyniku. Bez żadnej decyzji po stronie organizacji. Wpływ: do czasu ponownego ustawienia 2FA samo hasło wystarcza do wejścia na konfigurację 2FA, więc odtwarzanie jest za `SETUP_TOKEN` i pokazuje to ostrzeżenie.
Zrobione (etap b, ekran): w kreatorze po udanym sprawdzeniu serwera przycisk „Mam kopię zapasową: odtwórz z kopii” → plik, e-mail, hasło → sprawdzenie w przeglądarce (te same komunikaty co „Sprawdź kopię”, osobny komunikat dla nowszej kopii) → wysyłka kawałkami z postępem → wynik („Odtworzono: 230 osób, …”, ostrzeżenia o anonimizacjach po kopii, brakujących plikach, resecie 2FA) → logowanie.
Testy (`backupRestore.test.ts`, 7): pełny cykl przez HTTP (dane → kopia → anonimizacja po kopii → pusta baza → odtworzenie → logowanie tym samym hasłem → odsłonięcie danych wrażliwych z klucza prywatnego i slotu → usunięcie z D5 nałożone → załącznik bajt w bajt → dziennik, sprzątanie), reset 2FA przy innym `APP_SECRET`, odmowa na niepustej bazie, nowsza kopia, zły klucz i uszkodzone pliki (baza pusta, dysk czysty), złe kawałki i token, starsza kopia w nowszym schemacie (brakujące kolumny domyślne, nieznane ignorowane). Całość 855/855, typecheck i build czyste.
Nie zrobione / uwagi: **nie przeklikane w przeglądarce** (okno „Sprawdź kopię” i ścieżka w kreatorze); logika pokryta testami w Node na tych samych API (WebCrypto, `DecompressionStream`, `Blob`), przeklikanie przy wdrożeniu (krok 7). Odtwarzanie jest jednym żądaniem `finish` (limit 120 s Hostingera): przy bardzo dużej bazie może się nie zmieścić (do rozważenia: praca w tle ze sprawdzaniem stanu). Kreator nadal mówi w liście „Gotowe”, żeby włączyć kopie w panelu hostingu (nieaktualne, do poprawy w kroku 6).

### Krok 3, poprawki po przeglądzie Opusa (2026-11-15)
Naprawione: (1) błąd zapisu pliku roboczego (brak miejsca, uprawnienia) kończy się wyjątkiem, nie padnięciem procesu; (2) błąd po zatwierdzeniu bazy (przenoszenie plików, `applyErasures`, 2FA) cofa całość (baza znów pusta, pliki z kopii usunięte), więc kreator da się uruchomić ponownie i anonimizowane osoby nie zostają z danymi; lista usunięć z pliku dołączana w tej samej transakcji; (4) „Sprawdź kopię” nie zawiesza się, gdy czytnik ramek rzuci błąd; (5, 7) jedna wysyłka naraz, tylko identyfikator wydany przez `begin`, `begin`/`chunk` odmawiają w trakcie odtwarzania; (6) serwer sprawdza też `fileBytes` i tabele spoza zestawienia. Nowe testy: kopia wielosegmentowa uszkodzona na końcu (rollback, czysty dysk, ponowna próba działa), błąd po zatwierdzeniu bazy, obcy identyfikator wysyłki.
**Otwarte (decyzja MOC):** limit 120 s Hostingera dla `finish` (odtwarzanie w tle ze sprawdzaniem stanu to większa zmiana); test, że sesja po resecie 2FA nie ma dostępu do niczego poza konfiguracją 2FA; test równoległych wywołań.

### Krok 4, etap a (2026-11-15) — serwer i testy panelu „Stan bezpieczeństwa”
Zrobione: RPC `security.status` (admin; jedno wywołanie, 10 spraw z D8: wersja, HTTPS, `STORAGE_DIR`, ostatnia kopia, pobranie, sprawdzenie kopii, konta bez 2FA, dostęp do danych wrażliwych, zmiana klucza, osoby po okresie przechowywania jako szare „jeszcze nie skonfigurowane”). Serwer zwraca same fakty (kolor, liczby, daty, flagi, nazwy kont), zdania składa klient z `pl.ts` (etap b). Progi: kopia czerwona > 2 dni (brak `STORAGE_DIR` też czerwone, brak kopii i nieudana po udanej żółte), pobranie żółte > 7 dni, sprawdzenie żółte > 30 dni (licznik od zdarzenia, a bez niego od pierwszej kopii; pobranie liczy też kopie usunięte rotacją). Dostęp: czerwone bez żadnego konta ze slotem, żółte bez slotu odzyskiwania, szare bez klucza organizacji. Zmiana klucza w toku = żółte.
Wersja (D9): `services/updates.ts`: `fetch` z Node do `api.github.com/repos/Szmok0/NGO_CRM_Cloud/releases/latest` (stała w kodzie, tylko nagłówki `accept` i ogólne `user-agent`, bez ciała i identyfikatorów), timer godzinowy, pytanie najwyżej raz na dobę (po nieudanym ponowna próba przy kolejnym tyknięciu), wynik w pamięci procesu. „Security/bezpieczeństwo” w tytule → czerwone, nowsza wersja → żółte. Adres wydania z odpowiedzi przyjmowany tylko z `https://github.com/Szmok0/NGO_CRM_Cloud/`, inaczej strona wydań. Brak sieci, błąd GitHuba, śmieci → stan `failed` (szare), nie błąd. Data wydania: nowe pole `releaseDate` w `package.json` (do podbijania przy każdym wydaniu).
Wyłącznik: kolumna `settings.check_updates` (migracja 0014, domyślnie włączone), RPC `security.setUpdateCheck` (admin, przez repozytorium z blokadą wersji), wpis `update_check_changed` w dzienniku dostępu i etykieta. Po włączeniu serwer od razu pyta o wersję. Bez zmian CSP.
Testy: `securityStatus.test.ts` (18; sieć podstawiona, w tym brak sieci, błąd 500, zły kształt, wyłącznik, brak e-maili i id w odpowiedzi, uprawnienia); test uprawnień po wszystkich metodach przechodzi. Całość 885/885, typecheck i build czyste.
Uwagi: stan wersji jest w pamięci procesu (po restarcie do pierwszego sprawdzenia „jeszcze nie sprawdzono”, timer pyta zaraz po starcie). Status HTTPS: `req.protocol === 'https'`; na localhost bez HTTPS żółte.

### Krok 4, etap b (2026-11-15) — panel w Ustawieniach, skrót na „Dziś”, stopka
Zrobione: karta „Stan bezpieczeństwa” (`SecurityCard.tsx`) jako pierwsza w Ustawieniach administratora: lista 10 spraw, każda z kolorową kropką i etykietą (W porządku / Do zrobienia / Pilne / Brak oceny), zdaniem po ludzku i, gdy trzeba, „Co zrobić:” z przyciskiem przewijającym do właściwej karty (kopie, użytkownicy, zmiana klucza). Nowa wersja: „Jest nowa wersja X”, instrukcja w trzech krokach (GitHub → „Sync fork” → Hostinger), link „Zobacz, co się zmieniło”; poprawka bezpieczeństwa czerwona. Przycisk wyłączenia/włączenia sprawdzania wersji z opisem, że nic o organizacji nie jest wysyłane. Skrót na „Dziś” (czerwony pasek „Pilnych spraw w programie: N” z przejściem do Ustawień, tylko administrator, tylko gdy coś jest czerwone). Stopka Ustawień „Wersja programu 0.1.0 z 15.11.2026” dla wszystkich ról (z `package.json` w paczce klienta: tylko dwa pola, bez reszty pliku). Teksty w `pl.security` (`pl.ts`).
Sprawdzone w przeglądarce na zbudowanej aplikacji (lokalna baza testowa, konto próbne, port 3011): panel z wszystkimi sprawami, szare „nie udało się sprawdzić” przy braku wydania/połączenia, wyłączenie sprawdzania wersji (stan „wyłączone”), przycisk „Przejdź do kopii” przewija do karty kopii, stopka, brak naruszeń CSP w konsoli; po uruchomieniu bez `STORAGE_DIR` na „Dziś” pasek „Pilnych spraw w programie: 2”.
Nie sprawdzone w przeglądarce: stany „jest nowa wersja” i „poprawka bezpieczeństwa” (kolory, instrukcja, link) — pokryte tylko testami serwera, bo w sieci nie ma wydania do pobrania; przyciski dla kont bez 2FA, dostępu i zmiany klucza (testy danych po stronie serwera).
Odstępstwa: sprawy bez miejsca w programie (HTTPS, `STORAGE_DIR`) mają „Co zrobić” jako tekst, bez przycisku. Przycisk „Przejdź do kopii” stoi też przy szarych sprawach pobrania i sprawdzenia kopii (przewija do karty, gdzie jest „Sprawdź kopię”). Testy 885/885, typecheck i build czyste.

### Krok 4, poprawki po przeglądzie Opusa (2026-11-15)
Naprawione: (1) progi panelu liczone w milisekundach, tak jak `downloadDue` (kopia czerwona po 48 h, nie po 72 h; pobranie i sprawdzenie bez rozjazdu z kartą kopii), nowe testy graniczne; (2) po samych nieudanych kopiach panel mówi o nieudanej próbie, nie „pierwsza powstanie sama”; (3) czerwone „poprawka bezpieczeństwa” tylko ze znacznikiem w tytule wydania: `[bezpieczeństwo]` lub `[security]` (samo słowo, np. „Panel Stan bezpieczeństwa”, już nie wystarcza; do opisania w instrukcji wydawania wersji); (5) flaga `noStorage` w sprawie „kopia”, więc brak `STORAGE_DIR` nie daje tekstu „ma 0 dni”; (6) dziennik ma dwa wpisy `update_check_enabled` / `update_check_disabled`, ta sama wartość nie zapisuje i nie loguje; (7) tag z sufiksem (`1.2.3-rc1`) nie jest pełną wersją; (8) komentarz `BackupList` na swoim miejscu.
Nie zrobione (świadomie): (4) stan sprawdzania wersji tylko w pamięci procesu: na Hostingerze przy wielu instancjach lub restartach pytań do GitHuba będzie więcej niż raz na dobę, a wyłącznik odświeża tylko jeden proces. Trwały zapis w bazie to większa zmiana (kolumny, migracja); do decyzji MOC. Zapis ustawień i wpis w dzienniku nie są w jednej transakcji (repozytorium otwiera własną). Testów klienta (React) nie ma w projekcie.

### Krok 4, trwały stan sprawdzania wersji (2026-11-15, decyzja MOC)
Naprawia punkt (4) z przeglądu: wynik sprawdzeń trzyma teraz baza (`settings.update_info`, json, migracja 0015), nie pamięć procesu. Przeżywa restart i jest wspólny dla procesów, więc „raz na dobę” decyduje baza (po nieudanej próbie następna najwcześniej po godzinie, też po restarcie), a wyłącznik i panel widzą ten sam stan w każdej instancji. Zapis wprost, poza repozytorium (celowo: dane techniczne; przez repozytorium doba po dobie podbijałaby `version` ustawień i groziła konfliktem z administratorem edytującym formularz oraz zapełniała `change_log`). Dwie instancje mogą w tym samym momencie zapytać GitHub (jedno zbędne zapytanie, bez skutków). Test sprawdza zapis w bazie i brak podbicia wersji ustawień. Testy 885/885, typecheck i build czyste.

### Krok 5, etap a (2026-11-15) — serwer i testy: okresy przechowywania, kopia do pomocy
Zrobione (D10): migracja 0016 (`contacts.retention_snooze_until`), `services/retention.ts`, RPC `retention.list` / `retention.setPeriod` (1–240 miesięcy albo null, wpis `retention_changed`, ta sama wartość nie loguje) / `retention.snooze` („Zostaw jeszcze na rok”, kontrola wersji osoby, rok od dziś). Lista: tylko osoby (nie instytucje), bez usuniętych i zanonimizowanych, bez aktywnej roli `member` / `staff` / `donor`, bez odłożonych. Ostatnia aktywność = najpóźniejsza z: wpis na osi, data działania, w którym osoba uczestniczy (przyszłe działanie = nie po okresie), data zajęć z obecnością, zadanie przy osobie (otwarte = „dziś”), dzień dodania do bazy. Po okresie, gdy ostatnia aktywność jest starsza niż dzień sprzed N miesięcy (dokładnie N miesięcy temu jeszcze nie). Nic nie dzieje się automatycznie; „Anonimizuj” to istniejące `contacts.anonymize`. Sprawa `retention` w `security.status`: szara bez okresu, zielona bez osób, żółta z liczbą osób (`data: { configured, months, due }`, bez nazwisk).
Zrobione (D7): `services/supportCopy.ts` + `GET /api/support-copy` (admin, `attachment`, `no-store`, wpis `support_copy`). Lista dozwolonych pól: każda tabela ma regułę albo jest jawnie pominięta, nieznana tabela to błąd, nowa kolumna jest pomijana. Pominięte: `contact_identity`, `contact_sensitive`, `attachments`, `org_keys`, `key_slots`, `access_log`, `auth_sessions`, `invitations`, `backups`, `app_meta`. Etykiety „Osoba N” / „Instytucja N” / „Użytkownik N” / „Działanie N” / „Temat N” / „Zadanie N”; z `change_log` tylko liczba zmienionych pól; ustawienia bez nazwy organizacji i własnych nazw ról.
Testy: `retention.test.ts` (10), `supportCopy.test.ts` (5, w tym test „Kopia do pomocy”: fikcyjne dane z imionami, nazwiskami, e-mailami, telefonami, adresem, treścią wpisów, zadań, notatek; plik i odpowiedź HTTP bez żadnego z nich oraz bez wzorców e-mail/telefon; sprawdzone na celowo zepsutej regule). Całość 915/915, typecheck i build czyste.
Nie zrobione (etap b): ustawienie okresu w Ustawieniach, lista w panelu z „Anonimizuj” / „Zostaw jeszcze na rok”, przycisk kopii do pomocy z ostrzeżeniem, teksty `pl.ts` (sprawa `retention` w `SecurityCard` nadal pokazuje tekst „jeszcze nie skonfigurowane”), instrukcja wydawania wersji i opis kopii do pomocy w dokumentach.
Do przeglądu (najlepiej Opus): `supportCopy.ts` (czy lista dozwolonych pól niczego nie przepuszcza; `settings.enabledModules`, `activities.channel`, `contacts.retentionSnoozeUntil` to jedyne pola, które nie są identyfikatorem, datą, liczbą ani statusem) i `retention.ts` (definicja aktywności).

### Krok 5, etap a, poprawki po przeglądzie Opusa (2026-11-15)
Naprawione (okresy): do aktywności doliczeni prowadzący zajęcia, zgody (udzielenie, wycofanie) i role (nadanie, zakończenie, dodanie wiersza); osoba powiązana (`guardian`, `contact_person`, `works_at`) z kimś, kto nie jest po okresie albo ma aktywną rolę członek / pracownik / darczyńca, nie trafia na listę (bezpieczniejszy kierunek, do potwierdzenia przez MOC). Testy: prowadzący, zgoda, rola zakończona wczoraj i nowa, opiekun, strefa czasu.
Naprawione (kopia do pomocy): identyfikatory w pliku są losowe i spójne tylko w obrębie jednego pliku (prawdziwe UUID nie wychodzą), `note` w pliku mówi uczciwie „spseudonimizowane, nie anonimowe” i o umowie powierzenia, `settings.enabledModules` tylko ze znanych modułów, numeracja „Osoba N” po prawdziwej dacie (wcześniej sortowanie po tekście z `Date`), `change_log` tylko z 90 dni. Testy: brak prawdziwych id w pliku, numeracja z datami, filtr modułów, okno 90 dni.
**Do decyzji MOC (nie zmieniane):** (a) osoby w Koszu nigdy nie trafiają na listę, więc ich tożsamość zostaje bezterminowo (pokazać je z oznaczeniem „w Koszu” albo osobna sprawa w panelu?); (b) `retention.setPeriod` bez kontroli wersji po stronie klienta (jedno pole; wyjątek od zasady danych 2); (c) zapomniane otwarte zadanie przy osobie trzyma ją poza listą bez końca. W ekranie kopii do pomocy ostrzeżenie ma mówić „spseudonimizowane”, nie „anonimowe”.
Całość 920/920, typecheck i build czyste.
