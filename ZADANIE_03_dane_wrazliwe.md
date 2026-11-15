# ZADANIE 03 — Dane wrażliwe

Status: rozpisane 2026-11-15, decyzje D1–D15 zatwierdzone przez MOC 2026-11-15 · Kontekst: `CLAUDE.md` (zasady danych 1–10), `NGO_CRM_CLOUD_KONCEPCJA.md` (4.2, 4.4, 4.9), `NGO_CRM_CLOUD_BEZPIECZENSTWO.md` (rozdziały 4–6), `NGO_CRM_CLOUD_PROCESY_I_MODEL_DANYCH.md` (PR9, 2.2, 2.3, 2.7), ZADANIE_01 (klucze, sloty, kreator), ZADANIE_02 (zrobione 2026-11-15, ostatni commit `87688fd`)

## Cel
Uprawniona osoba wpisuje i odsłania dane wrażliwe osoby oraz dodaje i pobiera zaszyfrowane załączniki. Serwer widzi tylko szyfrogramy.

Administrator:
- nadaje i odbiera dostęp do danych wrażliwych,
- zmienia klucz organizacji,
- anonimizuje osobę.

Organizacja eksportuje dane osoby (prawo dostępu) i listy (CSV z ostrzeżeniem). Każde odsłonięcie, pobranie i eksport trafia do dziennika dostępu, który administrator może przejrzeć i wyeksportować.

## Poza zakresem (nie rób)
- Kopie, nakładanie `erased_contacts` po odtworzeniu kopii (funkcja powstaje tu, wywoła ją ZADANIE_04), panel „Stan bezpieczeństwa”, zanonimizowana kopia do pomocy technicznej — ZADANIE_04.
- Okresy przechowywania z przypomnieniem — ZADANIE_04.
- Pola własne oznaczone jako wrażliwe (nie ma jeszcze pól własnych).
- Szyfrowanie tożsamości (bezpieczeństwo, rozdział 7), wyszukiwanie, sortowanie i raporty po danych wrażliwych.
- Załączniki poza kartą osoby i działaniem (materiały i dokumenty z szablonów — ZADANIE_05 i dalej).
- Ustawialny czas automatycznej blokady kluczy (stała wartość wg D5).

## Krok 0: przed kodem
1. Przeczytaj: `src/client/crypto/*`, `src/client/lib/keyring.ts`, `src/client/App.tsx` (wejście po logowaniu), `src/server/auth/users.ts` (`revokeAccess`), `src/server/auth/setup.ts` (wersja 1 klucza i slot odzyskiwania), `src/server/db/repo.ts` (`NAMES_ONLY_TABLES`), `src/server/auth/accessLog.ts`, `src/shared/csv.ts` oraz desktopowe ekrany karty osoby (sekcja dokumentów) jako wzór wyglądu.
2. **Stan kodu, który wpływa na zadanie:**
   - sloty i wersje klucza organizacji są w bazie (kreator: wersja 1, slot administratora, slot odzyskiwania); wyłączenie i reset konta usuwają sloty,
   - przeglądarka trzyma w pamięci tylko klucz prywatny użytkownika; nikt jeszcze nie otwiera slotów,
   - `openRecoverySlot` istnieje, ekranu „Odzyskaj dostęp” nie ma,
   - `settings.sensitiveFieldsEnabled` ma wartość domyślną `true` (wymaganie: domyślnie wyłączone),
   - `change_log` zapisuje wartości dla `activities` i `tasks` (same nazwy pól tylko dla tożsamości i danych wrażliwych),
   - desktop nie ma pól wrażliwych; zestaw ustala D1.
3. **Decyzje (zatwierdzone przez MOC 2026-11-15):**

   **Dane i klucze**
   - **D1. Zestaw pól wrażliwych:** jeden JSON na osobę:
     - PESEL (suma kontrolna sprawdzana w przeglądarce),
     - orzeczenie (rodzaj/stopień, ważne do),
     - zdrowie,
     - sytuacja rodzinna,
     - notatki wrażliwe.
     
     Tylko osoby, bez instytucji. AES-GCM kluczem organizacji, losowe IV 96 bitów, AAD = `contact_id` + wersja klucza (bezpieczeństwo 5.4). Zamyka sprawę 2.7.3 z modelu danych (do potwierdzenia w wywiadach).
   - **D2. Domyślnie wyłączone:** migracja zmienia wartość domyślną `sensitiveFieldsEnabled` na `false`. Administrator włącza pola w ustawieniach organizacji (z ostrzeżeniem). Wyłączenie ukrywa pola, dane zostają. Załączniki działają niezależnie od przełącznika, ale tylko przy ustawionym `STORAGE_DIR`. Na instancji próbnej MOC włącza pola ręcznie.
   - **D3. Dostęp = slot, nie rola:**
     - slot może mieć każda rola; `readonly` ze slotem odsłania i pobiera, ale nie zapisuje,
     - serwer nie wydaje szyfrogramu ani pliku osobie bez slotu do niewycofanej wersji klucza (`NO_KEY_ACCESS`, 403); to minimalizacja, kryptograficznie nic nie zmienia.
   - **D4. Klucze w pamięci karty:**
     - po odblokowaniu przeglądarka otwiera swoje sloty (mapa wersja → klucz niewyeksportowalny),
     - przy nadawaniu dostępu i zmianie klucza slot jest otwierany ponownie z możliwością eksportu, tylko na czas operacji,
     - nic nie trafia do `localStorage` ani `sessionStorage`.
   - **D5. „Odblokuj” i blokada:**
     - po odświeżeniu strony dane wrażliwe i załączniki pokazują „Odblokuj”: okno z hasłem, `wrapKey` liczony w przeglądarce, nic nie idzie do serwera (złe hasło = błąd odszyfrowania),
     - automatyczna blokada kluczy po 15 min bezczynności (stała; krótsza niż wylogowanie po 30 min); zwykłe dane działają dalej.

   **Odsłanianie i dziennik**
   - **D6. Maskowanie i wpis w dzienniku:**
     - `contacts.get` nie zwraca szyfrogramu, tylko to, czy dane wrażliwe są i w jakiej wersji klucza,
     - szyfrogram daje `sensitive.reveal`, który na serwerze zapisuje `reveal_sensitive` (użytkownik, osoba), więc wpis nie zależy od przeglądarki,
     - odsłonięcie obejmuje wszystkie pola osoby naraz; zakrywa je wyjście z karty albo „Ukryj”,
     - edycja wymaga odsłonięcia.
   - **D7. Widok „Dziennik dostępu”** (tylko `admin`, w ustawieniach):
     - filtry: użytkownik, rodzaj zdarzenia, zakres dat,
     - nazwy osób i użytkowników dociągane przy wyświetlaniu (w dzienniku same identyfikatory),
     - eksport CSV na potrzeby incydentu (sam eksport też trafia do dziennika).

   **Nadawanie, odbieranie, zmiana klucza**
   - **D8. Nadawanie i odbieranie dostępu:**
     - lista użytkowników w ustawieniach z kolumną „Dane wrażliwe” i przyciskami Nadaj / Odbierz,
     - nadaje administrator, który sam ma slot; konto musi być aktywne i mieć klucz publiczny; przeglądarka tworzy sloty do wszystkich niewycofanych wersji klucza,
     - odebranie usuwa sloty tej osoby i kończy jej sesje (jak przy wyłączeniu konta),
     - wpisy `grant_access` / `revoke_access`,
     - po odebraniu dostępu albo wyłączeniu konta, które miało slot, administrator widzi propozycję zmiany klucza organizacji (D9); zmiana nie jest wymuszana.
   - **D9. Zmiana klucza organizacji:**
     - przeglądarka administratora losuje nową wersję, tworzy sloty dla wszystkich obecnie uprawnionych i nowy slot odzyskiwania,
     - **nowy klucz odzyskiwania do wydruku** z potwierdzeniem 4 ostatnich znaków (stary klucz odzyskiwania nie obejmie nowej wersji bez łańcucha kluczy, a łańcuch przekreśliłby sens zmiany),
     - nowe zapisy od razu w nowej wersji; stare rekordy przeszyfrowane partiami w przeglądarce administratora (z `version` każdego rekordu), z paskiem postępu; po przerwie wystarczy uruchomić ponownie, dokończy rekordy ze starszą wersją,
     - pliki załączników nie są przeszyfrowywane, tylko ich metadane (z kluczem pliku); plik pobrany wcześniej przez odchodzącą osobę i tak już wyciekł,
     - na koniec stara wersja dostaje `retiredAt`, jej sloty i slot odzyskiwania są usuwane.
   - **D10. „Odzyskaj dostęp”:** zalogowany administrator bez slotu wpisuje klucz odzyskiwania i dostaje slot do bieżącej wersji (bezpieczeństwo 5.3), wpis w dzienniku.

   **Załączniki**
   - **D11. Załączniki:**
     - tabela `attachments` jak w modelu 2.3 (`targetType`, `targetId`, `purpose`, `keyVersion`, `metaEnc`, `sizeBytes`, `storageKey`),
     - dwie trasy poza RPC, za strażnikiem sesji, 2FA, roli i slotu:
       - `POST /api/attachments`: surowe bajty szyfrogramu, `metaEnc` w nagłówku; plik tymczasowy → wiersz w bazie → zmiana nazwy pliku,
       - `GET /api/attachments/:id`: `application/octet-stream`, `Content-Disposition: attachment`, wpis `download_attachment`,
     - limit 20 MB; cały plik szyfrowany AES-GCM własnym losowym kluczem w pamięci przeglądarki,
     - miejsca: karta osoby („Dokumenty”) i szczegóły działania,
     - zapis i usuwanie: `admin` i `staff` ze slotem; usunięcie = `deletedAt` (Kosz), plik znika fizycznie dopiero przy anonimizacji,
     - bez `STORAGE_DIR` przycisk wyłączony z komunikatem. **Na produkcji MOC ustawia `STORAGE_DIR` przed wdrożeniem kroku 3.**

   **Anonimizacja i eksporty**
   - **D12. Anonimizacja** (tylko `admin`, także osoby w Koszu, nieodwracalna, potwierdzenie wpisaniem „ANONIMIZUJ”):
     - usuwa fizycznie: wiersz `contact_identity`, `contact_sensitive`, załączniki osoby (wiersze i pliki), tagi osoby (wolny tekst),
     - zostawia: `contacts` z `anonymizedAt`, role, zgody (bez danych osobowych), udział, obecność, powiązania (statystyka), dziennik dostępu (same identyfikatory),
     - **treść osi i zadań** (zamyka sprawę z bezpieczeństwa, rozdział 6, i 2.7.5 modelu danych):
       - wpisy powiązane **tylko z tą osobą** tracą treść, domyślnie zaznaczone (rodzaj, data, forma i czas zostają),
       - **wpisy wspólne** i **zadania przy osobie** okno pokazuje do przejrzenia, z polem „usuń treść” przy każdym (domyślnie odznaczone),
     - wpisy `change_log` czyszczonych rekordów zamienione na same nazwy pól; nowy wpis `anonymize`,
     - wiersz `erased_contacts` (id, data) i funkcja nakładająca usunięcia po odtworzeniu kopii (wywoła ją ZADANIE_04),
     - osoba wyświetla się jako „Osoba zanonimizowana” i nie da się jej edytować.
   - **D13. Eksport danych osoby (art. 15 RODO):**
     - `admin` i `staff`; serwer zwraca wszystko o osobie (tożsamość, role, zgody, powiązania, oś, udział, obecność, zadania, lista załączników) i zapisuje `export`,
     - przeglądarka dokłada odszyfrowane dane wrażliwe, jeśli użytkownik ma slot; bez slotu eksport oznaczony jako niepełny, z ostrzeżeniem,
     - wynik: plik JSON i wersja do druku z przeglądarki (jak lista obecności),
     - załączniki wymienione z nazwy, pobierane osobno (bez ZIP: wymagałby biblioteki).
   - **D14. Eksport CSV list** (osoby, działania, uczestnicy działania):
     - okno z ostrzeżeniem i wyborem kolumn; domyślnie minimum (nazwa, rodzaj, role); e-mail, telefon i adres trzeba zaznaczyć; danych wrażliwych nie ma w CSV nigdy,
     - plik buduje serwer (`src/shared/csv.ts`, format jak w desktopie) i zapisuje `export` z rodzajem listy; bez treści filtra (może zawierać nazwisko),
     - tylko `admin` i `staff`; `readonly` nie eksportuje CSV.
   - **D15. Bez nowych bibliotek i bez danych wrażliwych w demo:**
     - wszystko na WebCrypto (przeglądarka) i `node:crypto` (serwer),
     - `dev:demo` bez danych wrażliwych i załączników (skrypt nie zna hasła konta),
     - scenariusz akceptacji szyfruje dane w Node przez moduły `src/client/crypto` (WebCrypto jest w Node 22).
4. Przedstaw MOC krótki plan kroku 1 i listę plików. **Czekaj na akceptację.**

## Zasady (dotyczą każdego kroku)
- **Serwer nie dostaje klucza organizacji, klucza pliku ani jawnych danych wrażliwych** (zasada danych 10). Testy sprawdzają, że w bazie i w `STORAGE_DIR` są tylko szyfrogramy.
- **Dziennik dostępu zapisuje serwer**, w tej samej transakcji co operacja (wydanie szyfrogramu, pliku, eksportu, zmiana slotów). Tylko identyfikatory.
- **`change_log`:** `contact_sensitive` w `NAMES_ONLY_TABLES` (jest od ZADANIA_02). Nazwy pól wewnątrz szyfrogramu nie są znane serwerowi.
- **`version`:** każdy zapis odsyła `version`, także przeszyfrowanie przy zmianie klucza.
- **Logi serwera:** bez parametrów, nagłówków z metadanymi i nazw plików.
- **CSP:** bez atrybutów `style` (klasy). Pobieranie przez link `blob:` (`lib/download.ts`).
- **Teksty** w `src/client/i18n/pl.ts`.
- **Każdy krok:** a) serwer i testy, b) ekrany i sprawdzenie w przeglądarce na zbudowanej aplikacji pod CSP. Po każdym etapie commit i krótki wpis w „Wyniku”.

## Krok 1: klucze w przeglądarce i dostęp
- a) Serwer i testy:
  - RPC: `keys.mySlots` (sloty zalogowanej osoby do niewycofanych wersji), `access.list` (kto ma slot; `admin`), `access.grant` (sloty od przeglądarki administratora; `admin` ze slotem, konto aktywne z kluczem publicznym), `access.revoke` (usunięcie slotów + koniec sesji; `admin`), `keys.recover` (slot odzyskiwania i zapis nowego slotu dla zalogowanego administratora),
  - `users.disable` i `users.reset` zwracają, czy konto miało slot (propozycja zmiany klucza),
  - zdarzenia dziennika: `grant_access`, `revoke_access`, `key_recovered`,
  - testy: nadanie i odebranie (sesje zakończone), nadanie bez własnego slotu odrzucone, nadanie na konto bez klucza publicznego odrzucone, `keys.recover` tylko dla administratora, test uprawnień obejmuje nowe metody.
- b) Ekrany i przeglądarka:
  - `keyring.ts`: klucze organizacji w pamięci (D4), blokada po 15 min bezczynności (D5),
  - okno „Odblokuj” (dostępne z karty osoby i z ekranu konta), stan „zablokowane”,
  - ustawienia: kolumna „Dane wrażliwe” z Nadaj / Odbierz, baner z propozycją zmiany klucza (sama propozycja; zmiana w kroku 4),
  - ekran „Odzyskaj dostęp” dla administratora bez slotu.

## Krok 2: pola wrażliwe
- a) Serwer i testy:
  - tabela `contact_sensitive` (`contactId` UNIQUE, `keyVersion`, `iv`, `ciphertext` jako `mediumtext` Base64; klucz obcy do `contacts`),
  - migracja: wartość domyślna `sensitiveFieldsEnabled` = `false` (D2); `settings.update` obsługuje przełącznik,
  - `contacts.get`: `hasSensitive` i `sensitiveKeyVersion`, bez szyfrogramu,
  - `sensitive.reveal` (wpis `reveal_sensitive`), `sensitive.save` (tylko `admin`/`staff` ze slotem, bieżąca wersja klucza, limit rozmiaru, `version`),
  - testy: bez slotu 403, wpis w dzienniku przy każdym odsłonięciu, zapis starą wersją klucza odrzucony, `change_log` bez wartości, konflikt wersji, instytucja odrzucona, pola wyłączone → odmowa zapisu.
- b) Ekrany i przeglądarka:
  - `src/client/crypto/sensitive.ts` (szyfrowanie JSON z AAD, z testem: inny `contact_id` → błąd), walidacja PESEL (z testem),
  - sekcja „Dane wrażliwe” na karcie osoby: maska, „Odsłoń” / „Ukryj”, edycja, stany „brak dostępu”, „zablokowane”, „wyłączone”,
  - przełącznik w ustawieniach organizacji z ostrzeżeniem.

## Krok 3: załączniki
- a) Serwer i testy:
  - tabela `attachments` (D11), trasy `POST /api/attachments` i `GET /api/attachments/:id`, RPC `attachments.list` (dla celu), `attachments.delete`, przywracanie w Koszu,
  - kontrola: rozmiar (nagłówek i rzeczywista liczba bajtów), brak `STORAGE_DIR`, cel istnieje i nie jest usunięty, nagłówki CSRF jak przy RPC,
  - testy: bez slotu 403 (wysyłanie i pobieranie), `readonly` nie wysyła, plik ponad limit odrzucony i nie zostaje na dysku, pobranie z `Content-Disposition: attachment` i wpisem `download_attachment`, w `STORAGE_DIR` tylko szyfrogram pod losową nazwą.
- b) Ekrany i przeglądarka:
  - `src/client/crypto/files.ts` (klucz pliku, metadane: nazwa, typ, klucz pliku; z testem),
  - „Dokumenty” na karcie osoby i w szczegółach działania: dodanie, lista, pobranie, usunięcie.

## Krok 4: zmiana klucza organizacji
- a) Serwer i testy:
  - `keys.rotateStart`: nowa wersja w `org_keys`, sloty wszystkich uprawnionych i slot odzyskiwania w jednej transakcji (zestaw slotów musi odpowiadać `access.list`),
  - `keys.rotatePending` (rekordy ze starszą wersją), `keys.rotateBatch` (przeszyfrowane `contact_sensitive` i `metaEnc` z `version`), `keys.rotateFinish` (gdy nic nie zostało: `retiredAt`, usunięcie starych slotów),
  - zdarzenia `key_rotated`,
  - testy: przerwana rotacja wznawia się, zapis nową wersją w trakcie rotacji, zakończenie odrzucone przy pozostałych rekordach, stare sloty znikają, konflikt wersji przy równoczesnej edycji.
- b) Ekrany i przeglądarka:
  - kreator zmiany klucza: wyjaśnienie, nowy klucz odzyskiwania do wydruku z potwierdzeniem 4 ostatnich znaków, pasek postępu, wznowienie,
  - baner z kroku 1 prowadzi do kreatora.

## Krok 5: anonimizacja
- a) Serwer i testy:
  - `contacts.anonymizePreview` (wpisy tylko tej osoby, wpisy wspólne, zadania przy osobie, liczba załączników), `contacts.anonymize` (D12; jedna transakcja, pliki usuwane po zatwierdzeniu transakcji),
  - tabela `erased_contacts`, funkcja `applyErasures` (z testem; wywołanie w ZADANIU_04),
  - zdarzenie `anonymize` w dzienniku dostępu i `change_log`,
  - **test „Nic nie zostało”** (bezpieczeństwo 6, test 1): fikcyjna osoba z charakterystycznym nazwiskiem w tożsamości, notatce, wpisie na osi, zadaniu i nazwie załącznika → anonimizacja → nazwisko nie występuje w żadnej tabeli (zrzut wszystkich kolumn tekstowych) ani w `STORAGE_DIR`,
  - testy: tylko `admin`, osoba w Koszu, instytucja, ponowna anonimizacja odrzucona, edycja po anonimizacji odrzucona, statystyka frekwencji bez zmian.
- b) Ekrany i przeglądarka:
  - przycisk na karcie osoby (i w Koszu), okno z listą treści do przejrzenia i polami „usuń treść”, potwierdzenie wpisaniem „ANONIMIZUJ”,
  - karta osoby zanonimizowanej: same statystyki, bez akcji zapisu.

## Krok 6: eksporty i dziennik dostępu
- a) Serwer i testy:
  - `contacts.exportData` (D13, wpis `export`), `exports.csv` (D14: rodzaj listy, filtry, wybrane kolumny; wpis `export` bez filtra), `accessLog.list` i `accessLog.exportCsv` (D7, tylko `admin`),
  - testy: `readonly` nie eksportuje CSV, CSV bez danych wrażliwych i domyślnie bez e-maili i telefonów, wpisy w dzienniku, filtry dziennika.
- b) Ekrany i przeglądarka:
  - „Eksportuj CSV” w liście osób, liście działań i uczestnikach działania: okno z ostrzeżeniem i wyborem kolumn,
  - „Eksport danych osoby” na karcie: JSON (z danymi wrażliwymi po odblokowaniu) i wersja do druku,
  - widok „Dziennik dostępu” w ustawieniach (zdarzenia po polsku, filtry, eksport).

## Krok 7: scenariusz akceptacji, wdrożenie
- `src/server/acceptance.test.ts` rozszerzony (szyfrowanie w Node przez `src/client/crypto`): administrator, pracownik ze slotem, pracownik bez slotu, tylko odczyt ze slotem; nadanie, odsłonięcie, załącznik, odebranie dostępu, zmiana klucza, anonimizacja, eksporty, dziennik.
- `npm audit`.
- Wdrożenie na Hostinger po zgodzie MOC (`STORAGE_DIR` ustawiony w panelu), przeklikanie kryteriów na instancji próbnej (tylko dane fikcyjne).

## Kryteria akceptacji (scenariusz do przeklikania)
1. `npm run typecheck`, `npm test` i `npm run build` przechodzą. Test uprawnień obejmuje wszystkie nowe metody i trasy załączników.
2. Pola wrażliwe są domyślnie wyłączone. Po włączeniu wpisuję PESEL i notatkę wrażliwą. W bazie jest tylko szyfrogram, w `change_log` tylko nazwa pola.
3. Pola są zamaskowane. „Odsłoń” pokazuje dane i dopisuje wpis do dziennika dostępu. Konto bez slotu widzi „brak dostępu”, a serwer zwraca 403.
4. Po odświeżeniu strony dane wrażliwe pokazują „Odblokuj”. Po podaniu hasła działają. Po 15 min bezczynności blokują się same.
5. Administrator nadaje dostęp pracownikowi: pracownik odsłania dane. Po odebraniu dostępu sesja pracownika się kończy, a po ponownym logowaniu nie ma dostępu.
6. Zmiana klucza organizacji: drukuję nowy klucz odzyskiwania, dane i załączniki czytają się po zmianie, stare sloty znikają. Przerwana zmiana daje się dokończyć.
7. Dodaję załącznik (do 20 MB) do osoby i działania. W `STORAGE_DIR` jest tylko szyfrogram pod losową nazwą. Pobranie zapisuje plik pod właściwą nazwą i dopisuje wpis do dziennika. Plik ponad limit jest odrzucony.
8. „Odzyskaj dostęp” z kluczem odzyskiwania przywraca administratorowi dostęp.
9. Anonimizacja: tożsamość, dane wrażliwe i załączniki znikają, statystyka frekwencji bez zmian, osoba widoczna jako „Osoba zanonimizowana”. Test „Nic nie zostało” przechodzi.
10. Eksport danych osoby daje plik JSON i wydruk. Bez slotu eksport jest oznaczony jako niepełny.
11. Eksport CSV listy osób pokazuje ostrzeżenie, domyślnie ma minimalny zestaw kolumn i nigdy nie zawiera danych wrażliwych. `readonly` nie eksportuje.
12. Dziennik dostępu pokazuje odsłonięcia, pobrania, eksporty, nadania i odebrania dostępu, zmianę klucza i anonimizację. Da się go wyeksportować.
13. Na Hostingerze wszystko działa po HTTPS, konsola jest bez błędów CSP, a logi serwera bez danych osobowych, nazw plików i parametrów.
14. Commit i `git push` po akceptacji MOC.

## Po zakończeniu
Krótkie podsumowanie dla MOC w „Wyniku”:
- co zrobiono,
- odstępstwa od opisu i powody,
- co trzeba przenieść do desktopu (bezpieczeństwo, rozdział 9),
- otwarte sprawy na ZADANIE_04.

Nie aktualizuj Sejfu bez zgody MOC.

## Wynik
_(uzupełniane po każdym etapie)_

### Krok 1, etap a (2026-11-15): serwer i testy
- Nowe RPC (`src/server/auth/access.ts`):
  - `keys.mySlots` (wszystkie role),
  - `keys.recoverySlot` i `keys.recover` (`admin`),
  - `access.list`, `access.grant`, `access.revoke` (`admin`).
- `users.disable` i `users.reset` zwracają `hadAccess`.
- Zdarzenia dziennika: `grant_access`, `revoke_access`, `key_recovered`.
- Nowe błędy: `NO_KEY_ACCESS` (403), `ACCESS_EXISTS` i `ACCOUNT_NOT_READY` (409).
- Testy: `src/server/auth/access.test.ts`; test uprawnień obejmuje nowe metody automatycznie. Typecheck, 649 testów i build przechodzą.
- **Odstępstwa (zatwierdzone przez MOC):**
  - odzyskiwanie to dwie metody, bo przeglądarka musi najpierw dostać slot odzyskiwania: `keys.recoverySlot` wydaje go tylko administratorowi bez slotu do bieżącej wersji, `keys.recover` zapisuje nowy slot;
  - ponowne nadanie dostępu → `ACCESS_EXISTS`;
  - administrator nie odbiera dostępu samemu sobie (400).
- Szczegóły:
  - `access.grant` wymaga slotów dokładnie do niewycofanych wersji klucza i blokuje te wersje na czas transakcji (pod zmianę klucza w kroku 4);
  - `access.revoke` u osoby bez slotu nic nie robi (`hadAccess: false`): nie kończy jej sesji i nie dopisuje wpisu;
  - `access.list` zwraca klucz publiczny tylko dla aktywnych kont.
- W `SettingsScreen.tsx` dostosowałem jedno wywołanie `users.disable` do nowego typu wyniku. Baner z propozycją zmiany klucza powstanie w etapie b.

### Krok 1, etap b (2026-11-15): ekrany
- `lib/keyring.ts`: klucz prywatny i mapa wersja → klucz organizacji (niewyeksportowalny) tylko w pamięci karty; `useKeyring()` (stan do komponentów), `unlockKeys`, `unlockWithPassword` (złe hasło → `WrongPasswordError`), `openExportableOrgKeys()` (eksportowalne klucze tylko na czas operacji), `startIdleLock()` (blokada po 15 min, uruchamiana w `App.tsx`).
- Nowe: `components/UnlockDialog.tsx` (okno „Odblokuj”), `screens/RecoverAccessCard.tsx` („Odzyskaj dostęp” dla administratora bez slotu).
- `SettingsScreen.tsx`: przycisk „Odblokuj” przy kluczu, kolumna „Dane wrażliwe” z Nadaj / Odbierz, baner z propozycją zmiany klucza po odebraniu dostępu albo wyłączeniu lub resecie konta, które miało slot (sama propozycja, zmiana w kroku 4). Usunięty prop `keysUnlocked` (stan z `useKeyring`).
- Teksty w `pl.ts` (`unlock`, `recover`, `access`).
- Testy: `lib/keyring.test.ts` (6). Typecheck, 655 testów i build przechodzą.
- **Odstępstwo:** przycisk „Odblokuj” jest tylko na ekranie konta; na karcie osoby pojawi się w kroku 2 (karta nie ma jeszcze danych wrażliwych).
- **Niesprawdzone:** przeklikanie w przeglądarce na zbudowanej aplikacji pod CSP. `npm run dev:account` odmówił (lokalna baza ma inne konta), więc nie było konta do zalogowania.

### Krok 2, etap a (2026-11-15): serwer i testy
- Tabela `contact_sensitive` (`contactId` UNIQUE z FK do `contacts`, `keyVersion` z FK do `org_keys`, `iv`, `ciphertext` jako `mediumtext`), migracja `0010_thick_jackal.sql`.
- Migracja zmienia domyślne `sensitiveFieldsEnabled` na `false` **i ustawia `false` w istniejącym wierszu ustawień** (zatwierdzone przez MOC). Na instancji próbnej trzeba po wdrożeniu włączyć pola ręcznie (D2).
- `settings.get` zwraca `sensitiveFieldsEnabled`; `settings.update` ma opcjonalne pole o tej nazwie (brak = bez zmiany, obecny ekran ustawień działa bez zmian).
- `contacts.get`: `hasSensitive` i `sensitiveKeyVersion`, bez szyfrogramu.
- Nowe RPC (`src/server/services/sensitive.ts`):
  - `sensitive.reveal` (wszystkie role): slot do wersji klucza rekordu, wersja niewycofana, inaczej `NO_KEY_ACCESS`; wpis `reveal_sensitive` (cel `contact`) w tej samej transakcji; zwraca `version`, `keyVersion`, `iv`, `ciphertext`.
  - `sensitive.save` (`admin`/`staff`): tylko osoba (instytucja → 400; Kosz, zanonimizowana, brak → 404), wyłącznie bieżąca wersja klucza i slot do niej, `version` = null przy pierwszym zapisie, konflikt → `VERSION_CONFLICT`; IV 16 znaków base64, szyfrogram do 64 KB (`SENSITIVE_MAX_CIPHERTEXT`). Zwraca `{ version }`.
  - Pola wyłączone → `FORBIDDEN` dla obu metod (wyłączenie ukrywa też odsłonięcie).
- `logAccess` dostał parametr `targetType` (`user` domyślnie, `contact`).
- Testy: `src/server/services/sensitive.test.ts` (13); test uprawnień obejmuje nowe metody automatycznie. Typecheck, 678 testów i build przechodzą.
- **Uwaga techniczna:** MariaDB nie zna `SELECT … FOR SHARE` (składnia MySQL 8), dlatego zapis blokuje wiersze `org_keys` przez `FOR UPDATE` jak `access.grant`. Zapisy danych wrażliwych idą przez to po kolei, co przy skali NGO nie ma znaczenia.

### Krok 2, etap b (2026-11-15): ekrany
- `crypto/sensitive.ts`: `SensitiveFields` (PESEL, orzeczenie: rodzaj/stopień i ważne do, zdrowie, sytuacja rodzinna, notatki), `encryptSensitive` / `decryptSensitive` (AES-GCM, IV 12 bajtów, AAD `ngo-crm/sensitive/{contactId}/v{keyVersion}`; przy odczycie tylko znane pola tekstowe).
- `lib/pesel.ts`: `isValidPesel` (11 cyfr, data z kodowaniem stulecia w miesiącu, suma kontrolna).
- `lib/keyring.ts`: `currentOrgKeyVersion()` (najnowsza wersja ze slotów; serwer i tak sprawdza bieżącą).
- `views/contacts/SensitiveCard.tsx` na karcie osoby (pod „Dane”, `key` = id osoby):
  - stany: zablokowane (z przyciskiem „Odblokuj”, zamyka odstępstwo z etapu 1b), brak dostępu, brak danych („Uzupełnij”), maska z „Odsłoń”, odsłonięte z „Ukryj” i „Edytuj”;
  - jawne dane tylko w stanie komponentu: znikają po „Ukryj”, wyjściu z karty i blokadzie kluczy;
  - edycja w oknie: walidacja PESEL, limity długości (teksty do 4000 znaków, szyfrogram mieści się w 64 KB); konflikt wersji → ponowne odsłonięcie aktualnych danych i komunikat;
  - wyłączone pola: karta znika, a gdy osoba ma zapisane dane, zostaje sama informacja „wyłączone, dane zostają”.
- `OrgSettingsCard.tsx`: przełącznik „Pola wrażliwe” z ostrzeżeniem przy włączaniu i podpowiedzią przy wyłączaniu; zapis w `settings.update`.
- Teksty w `pl.ts` (`sensitive`, `orgSettings.sensitive*`).
- Testy: `crypto/sensitive.test.ts` (5, w tym inny `contact_id` → błąd), `lib/pesel.test.ts` (4). Typecheck, 687 testów i build przechodzą.
- **Sprawdzone w przeglądarce** na zbudowanej aplikacji (`npm run build`, `node dist/server/index.js`) pod CSP, na osobnej lokalnej bazie `test_ngocrm_ui`. Użytkownik `ngocrm` nie może zakładać baz, ale MariaDB pozwala wszystkim na bazy `test_%`. Konto założyłem kreatorem z `SETUP_TOKEN`.
  - Kreator: wersja 1 klucza, slot administratora. Ustawienia pokazują „odblokowany w tej karcie” i „ma dostęp”.
  - Przełącznik w ustawieniach: ostrzeżenie przy włączaniu, podpowiedź przy wyłączaniu, zapis.
  - Karta osoby:
    - „Brak danych” → „Uzupełnij” (zły PESEL blokuje zapis) → zapis i dane odsłonięte → „Ukryj” (maska) → „Odsłoń”;
    - po odświeżeniu „zablokowane” → „Odblokuj” (złe hasło → komunikat, dobre → maska) → edycja istniejącego rekordu;
    - wyłączone pola → informacja „wyłączone, dane zostają”.
  - W bazie: w `contact_sensitive` sam szyfrogram (IV 16 znaków, bez PESEL i tekstu), `access_log` zawiera `reveal_sensitive` (cel `contact`), `change_log` same nazwy pól. Brak błędów CSP w konsoli.
- **Niesprawdzone (potrzebne drugie konto):** stan „brak dostępu” na karcie, Nadaj / Odbierz, baner zmiany klucza, ekran „Odzyskaj dostęp”. Do zrobienia w scenariuszu akceptacji (krok 7) albo przy kroku 3b.
- **Drobne w wyglądzie (bez zmian):** etykieta „Orzeczenie (rodzaj / stopień)” łamie się w kolumnie 10rem; komunikat o złym PESEL jest szarą podpowiedzią, nie czerwonym błędem.

### Krok 3, etap a (2026-11-15): serwer i testy
- Tabela `attachments` (D11: `targetType`, `targetId`, `purpose`, `keyVersion` z FK do `org_keys`, `metaEnc`, `sizeBytes`, `storageKey` UNIQUE), migracja `0011_gifted_professor_monster.sql`. `attachments` dopisane do `NAMES_ONLY_TABLES` (change_log bez metadanych).
- Trasy poza RPC w `src/server/attachmentRoutes.ts` (sesja → 2FA → rola → walidacja → slot):
  - `POST /api/attachments` (`admin`/`staff`): surowy strumień `application/octet-stream` (parser tylko w tym zakresie), nagłówki `x-target-type`, `x-target-id`, `x-key-version`, `x-meta-enc`, opcjonalnie `x-purpose`; limit 20 MB + 28 B narzutu (`ATTACHMENT_MAX_BYTES`), sprawdzany w `Content-Length` i w liczbie przesłanych bajtów. Dostęp (cel, bieżąca wersja klucza, slot) sprawdzany przed przyjęciem bajtów i jeszcze raz w transakcji. Plik tymczasowy → wiersz (przez repo) → `rename` w transakcji; po każdym błędzie plik znika z dysku.
  - `GET /api/attachments/:id` (wszystkie role ze slotem do wersji klucza załącznika): `Content-Disposition: attachment`, `no-store`, wpis `download_attachment` (`targetType` `attachment`) w transakcji ze sprawdzeniem slotu.
  - Bez `STORAGE_DIR` obie trasy → 400.
- RPC `attachments.list` (wszystkie role), `attachments.delete` (`admin`/`staff` ze slotem; Kosz). `trash.list` i `trash.restore` obsługują `attachments` (etykieta „Załącznik (zaszyfrowany)”, nazwa pliku jest zaszyfrowana); dopisana etykieta w `pl.ts`, żeby przeszedł typecheck klienta.
- Testy: `src/server/services/attachments.test.ts` (15). Typecheck, 712 testów i build przechodzą. Test uprawnień obejmuje nowe metody RPC automatycznie; trasy plików mają własne testy (401, brak 2FA, rola, slot, limit, CSRF).
- Nie zrobione tu: ekrany i `crypto/files.ts` (etap b), usuwanie plików przy anonimizacji (krok 5).

### Krok 3, etap b (2026-11-15): ekrany i przeglądarka
- `crypto/files.ts`: `encryptFile` (losowy klucz pliku AES-GCM, ciało = IV 12 B + szyfrogram, narzut 28 B), `decryptMeta`, `decryptFile`. `metaEnc` = base64(IV + szyfrogram JSON `{name, type, fileKey}`) kluczem organizacji; nazwa przycinana do 200 znaków, całość ≤ `ATTACHMENT_MAX_META`. AAD metadanych: `ngo-crm/attachment-meta/{targetType}/{targetId}/v{keyVersion}`, pliku: `ngo-crm/attachment-file/v{keyVersion}`.
- `lib/api.ts`: `attachmentApi.upload` (`POST /api/attachments`, nagłówki `x-target-*`, `x-key-version`, `x-meta-enc`, `X-NGO-CRM`) i `download`; `lib/download.ts`: `downloadBlob` (link `blob:`).
- `components/AttachmentsCard.tsx` („Dokumenty”) na karcie osoby/instytucji i w zakładce Informacje szczegółów działania. Stany: zablokowane (Odblokuj), brak dostępu, brak `STORAGE_DIR` (przycisk wyłączony z komunikatem), `readonly` bez dodawania i usuwania; limit `ATTACHMENT_MAX_PLAIN_BYTES`, usunięcie do Kosza (z potwierdzeniem). Teksty w `pl.attachments`.
- Zmiana poza zakresem opisu: `auth.me` zwraca `storageConfigured` (czy serwer ma `STORAGE_DIR`), bo klient inaczej nie wie, że ma wyłączyć przycisk.
- Testy: `crypto/files.test.ts` (3: te same bajty i narzut 28 B, zły klucz/cel/wersja/zmieniony plik → błąd, długa nazwa). Typecheck, 715 testów i build przechodzą.
- **Sprawdzone w przeglądarce** na zbudowanej aplikacji (CSP, osobna baza `test_ngocrm_ui`, `STORAGE_DIR` ustawiony, konto z kreatora): dodanie pliku, lista (nazwa z polskimi znakami, rozmiar), pobranie (nazwa `Orzeczenie żółć.pdf`, typ, bajty identyczne), usunięcie, po odświeżeniu „zablokowane” z „Odblokuj”. W `STORAGE_DIR` jeden plik 3028 B (3000 + 28), bez nazwy i treści jawnej. Brak błędów CSP, brak atrybutów `style`.
- **Niesprawdzone:** szczegóły działania (ten sam komponent, nie klikane), stan „brak dostępu” i `readonly` (potrzebne drugie konto), „brak STORAGE_DIR” w przeglądarce, Kosz z załącznikiem w UI.

### Krok 4, etap a (2026-11-15): serwer i testy
- Stan rotacji bez nowej tabeli: rotacja trwa, gdy są co najmniej dwie niewycofane wersje klucza (najnowsza = bieżąca). Zapisy danych wrażliwych i plików już wcześniej przyjmowały tylko bieżącą wersję, a `access.grant` w trakcie rotacji wymaga slotów do obu wersji.
- Nowe RPC (`src/server/auth/rotation.ts`, tylko `admin` ze slotami do wszystkich niewycofanych wersji):
  - `keys.rotateStart`: `keyVersion` = największa + 1, sloty dokładnie dla osób ze slotem do bieżącej wersji (jak `access.list`, bez powtórzeń), nowy slot odzyskiwania; jedna transakcja z blokadą wierszy `org_keys` i slotów. Druga rotacja w trakcie → `ROTATION_IN_PROGRESS` (409).
  - `keys.rotatePending({ limit ≤ 100, domyślnie 50 })`: bieżąca wersja, liczby pozostałych rekordów, partia `contact_sensitive` (szyfrogram) i `attachments` (`metaEnc`, cel) z `version`; **także rekordy w Koszu**.
  - `keys.rotateBatch`: zapis przez repozytorium (`version` + 1, `change_log` z samymi nazwami pól). Rekord zmieniony lub usunięty w międzyczasie albo już w bieżącej wersji jest pomijany i wraca w `conflicts`; reszta partii się zapisuje.
  - `keys.rotateFinish`: przy pozostałych rekordach `ROTATION_PENDING` (409); inaczej `retiredAt` starszych wersji i usunięcie ich slotów (z odzyskiwaniem).
- Zdarzenia dziennika (decyzja MOC a): `key_rotation_started` i `key_rotated`. Bez wpisów `reveal_sensitive` przy przeszyfrowaniu (decyzja b). Nowe kody błędów z komunikatami w `pl.ts` (decyzja c).
- `requireOwnSlots` w `access.ts` wyeksportowane do ponownego użycia.
- Testy: `src/server/auth/rotation.test.ts` (6): start i sloty, odrzucenia startu (zły zestaw, powtórzenie, zła wersja, bez slotu, druga rotacja), przerwana rotacja wznawia się i obejmuje Kosz, zakończenie odrzucone przy pozostałych rekordach, stare sloty i slot odzyskiwania znikają, zapis w trakcie rotacji (nowa wersja tak, stara nie), konflikt wersji przy równoczesnej edycji, partia starą wersją i bez slotu odrzucona. Test uprawnień obejmuje nowe metody automatycznie. Typecheck, 741 testów i build przechodzą.

### Krok 4, etap b (2026-11-15): kreator zmiany klucza
- `lib/rotation.ts` (start, partie, zakończenie, wykrycie trwającej zmiany po liczbie slotów w `keys.mySlots`) i `screens/RotateKeyCard.tsx` na stronie Ustawienia (tylko `admin`): wyjaśnienie, nowy klucz odzyskiwania do wydruku z potwierdzeniem 4 ostatnich znaków (wydruk tylko klucza: portal w `body` + klasa `print-recovery`, reguła w `styles.css`), pasek postępu, „Dokończ zmianę” po przerwaniu lub błędzie. Baner po odebraniu dostępu ma przycisk „Zmień klucz”. Teksty w `pl.rotate`.
- **Poprawka znaleziona przy okazji:** AAD pliku zawierało wersję klucza, więc po przeszyfrowaniu metadanych (nowa `keyVersion` rekordu) stary plik by się nie odszyfrował. Metadane mają teraz `fileVersion` (wersja z AAD pliku, zachowywana przy kolejnych zmianach; brak = `keyVersion` rekordu, więc stare wpisy działają). Plik nie jest przeszyfrowywany.
- Rekordu, którego nie da się odszyfrować, nie pomijamy: zmiana staje z komunikatem, stary klucz zostaje. 5 partii z samymi konfliktami = komunikat o zacięciu.
- Testy: `reencryptMeta` i `reencryptSensitive` (nowy klucz i wersja działają, stary i zła wersja nie, `fileVersion` zachowane przy drugiej zmianie). Typecheck, 743 testy i build przechodzą.
- **Sprawdzone w przeglądarce** (zbudowana aplikacja, CSP, osobna baza): cały kreator, błędne i poprawne 4 znaki, postęp, dane wrażliwe i pobranie załącznika po zmianie identyczne, w bazie stara wersja `retiredAt`, tylko sloty bieżącej wersji, `keyVersion` = 2, wpisy `key_rotation_started` / `key_rotated`; wznowienie po odświeżeniu w trakcie (baza); brak błędów CSP i atrybutów `style`.
- **Niesprawdzone:** przycisk w banerze (potrzebne drugie konto), odczyt danych po wznowionej zmianie (tylko baza), faktyczny wydruk.

### Krok 5, etap a (2026-11-15): serwer i testy
- Decyzje MOC przed etapem: (a) `erased_contacts` trzyma też id wyczyszczonych wpisów i zadań (same UUID), żeby `applyErasures` powtórzyło wybór administratora; (b) anonimizacja czyści też wolny tekst przy rolach (`note`), zgodach (`basis`, `note`), powiązaniach (`note`, obie strony) i udziale w działaniach (`note`). Wiersze zostają.
- Tabela `erased_contacts` (`contactId` PK, `erasedAt`, `clearedActivityIds`, `clearedTaskIds`; nie jest domenowa), migracja `0012_panoramic_vargas.sql`. `ANONYMIZE_CONFIRM` w `domain.ts`, zdarzenie `anonymize` w dzienniku dostępu.
- `src/server/services/anonymize.ts`, RPC tylko `admin`:
  - `contacts.anonymizePreview({ id })`: `version`, `ownActivities` (wpisy tylko tej osoby, także z Kosza), `sharedActivities`, `tasks` (z treścią do przejrzenia), liczba `attachments`. Wpisy systemowe pominięte (JSON zdarzenia bez danych osobowych, potrzebny do wyświetlenia).
  - `contacts.anonymize({ id, version, clearActivityIds, clearTaskIds, confirm: 'ANONIMIZUJ' })`, jedna transakcja: `contacts` przez repo (`tags` = [], `anonymizedAt`, `version` + 1, konflikt → `VERSION_CONFLICT`), fizyczne usunięcie `contact_identity`, `contact_sensitive` i załączników osoby (też z Kosza), notatki jak wyżej, treść wpisów tylko tej osoby zawsze (`content` = '', `form` = null), wybranych wpisów wspólnych i zadań (`title` = '', `description` = null, etykiety checklisty = ''). Id spoza osoby są ignorowane. `change_log` tych rekordów zamieniony na same nazwy pól, nowy wpis `op: 'anonymize'`, wiersz `erased_contacts`, wpis w dzienniku. Pliki znikają z `STORAGE_DIR` po zatwierdzeniu transakcji (brak pliku nie jest błędem).
  - Odmowy: instytucja → `VALIDATION`/`PERSON_ONLY`, ponownie → `VALIDATION`/`ALREADY_ANONYMIZED`, brak → 404. Osoba w Koszu da się zanonimizować i zostaje w Koszu.
  - `applyErasures(db, storageDir?)`: dla każdej osoby z listy, obecnej w bazie, powtarza usunięcie (idempotentne, ten sam kod co anonimizacja). Zwraca liczbę osób. Wywoła ją ZADANIE_04.
- Edycja po anonimizacji: `roles.add`, `consents.add`, `relationships.add`, `activities.add`, `participants.add`, `tasks.create`/`update` z celem w osobie zanonimizowanej → 404 (dotąd sprawdzały tylko `deletedAt`).
- Testy `src/server/services/anonymize.test.ts` (11): podgląd; **„Nic nie zostało”** (nazwisko w tożsamości, notatce, tagu, wpisie własnym i wspólnym, formie wsparcia, zadaniu, checkliście, notatkach roli, zgody, powiązania i udziału oraz w treści pliku → po anonimizacji brak w każdej kolumnie tekstowej każdej tabeli wg `information_schema` i w plikach `STORAGE_DIR`); nieoznaczone wpisy wspólne i zadania zostają; statystyka (obecność, udział, role, powiązania, `actions.get`) bez zmian; tylko `admin`; potwierdzenie, stara wersja, instytucja, brak; cudze id ignorowane; Kosz i ponowna anonimizacja; edycja po anonimizacji; `applyErasures` po „odtworzeniu kopii” (dwa razy) i pominięcie nieobecnej osoby. Typecheck, 764 testy i build przechodzą.
- **Uwagi:** w teście załącznik ma losowe `metaEnc`, bo typecheck serwera nie zna `CryptoKey` z `src/client/crypto` (to trzeba rozwiązać w kroku 7, gdy test akceptacji ma szyfrować przez kod klienta). Treść wyczyszczonego wpisu i zadania to pusty tekst, więc etykietę „treść usunięta” ma pokazać interfejs (etap b). Kody `PERSON_ONLY` i `ALREADY_ANONYMIZED` nie mają jeszcze komunikatów w `pl.ts`. Nazwisko wpisane w cudzych rekordach (np. opis działania, notatka innej osoby) zostaje, bo nie da się go powiązać z osobą.

### Krok 5, etap b (2026-11-15): ekrany anonimizacji
- `src/client/components/AnonymizeDialog.tsx`: podgląd (`contacts.anonymizePreview`), wpisy tylko tej osoby (treść znika zawsze, tylko do wglądu), wpisy wspólne i zadania z polami „usuń treść” (domyślnie niezaznaczone), liczba załączników, potwierdzenie wpisaniem „ANONIMIZUJ”. Komunikaty `PERSON_ONLY` i `ALREADY_ANONYMIZED` rozpoznawane po `detail` błędu `VALIDATION` (`pl.anonymize`).
- Przycisk „Anonimizuj…” na karcie osoby i w Koszu: tylko `admin`, tylko osoba jeszcze niezanonimizowana (w Koszu: osoba z niepustą etykietą).
- Karta osoby zanonimizowanej: komunikat informacyjny, brak akcji zapisu (wynika z `identityVersion = null`). Pusta treść wpisu na osi i pusty tytuł zadania w liście zadań przy osobie pokazują „(treść usunięta)”.
- `anonymize` dopisane do listy mutacji w `lib/api.ts` (odświeżenie liczników).
- Typecheck, 764 testy i build przechodzą. **Niesprawdzone w przeglądarce** (przeklikanie kryterium 9 jeszcze przed nami). Testów komponentów nie ma (jak w reszcie widoków).
- **Uwaga:** zadania ze skasowanym tytułem mogą pokazywać pusty tytuł w innych widokach (np. lista zadań, kalendarz); do sprawdzenia przy przeklikaniu.

### Krok 6, etap a (2026-11-15): serwer i testy
- Kontrakt (`src/shared/api.ts`): `contacts.exportData` (`admin`, `staff`), `exports.csv` (`admin`, `staff`; `readonly` odrzucony), `accessLog.list` i `accessLog.exportCsv` (tylko `admin`). Filtry list (`contactFilter`, `actionFilter`) wyjęte do wspólnych stałych, żeby widok i eksport używały tych samych.
- `services/exports.ts`:
  - `contacts.exportData({ id })`: `{ exportedAt, detail: ContactDetail, attachments }` (metadane załączników zaszyfrowane, szyfrogramu danych wrażliwych brak; dokłada go przeglądarka po `sensitive.reveal`). Osoba z Kosza tak; instytucja → `VALIDATION`/`PERSON_ONLY`, zanonimizowana → 404. Wpis `export` (`contact`, id osoby) zapisany po odczycie.
  - `exports.csv`: rodzaj listy `contacts` / `actions` / `participants` (z `actionId`), filtry jak w widokach, `columns` wymagane (min. 1). Kolumny w kolejności kontraktu. Plik bez BOM (dokleja go zapis w przeglądarce), nazwy kolumn i wartości po polsku (`src/shared/exportLabels.ts`; własne nazwy ról organizacji z ustawień). Kolumn wrażliwych i notatek z tożsamości nie da się zażądać (zod). Osoby zanonimizowane i z Kosza poza plikiem. Wpis `export` z rodzajem listy (`contacts_list`, `actions_list`, `participants_list` + id działania), bez filtra.
  - Ochrona przed formułami Excela: `csvText` w `src/shared/csv.ts` (apostrof przed `=`, `@`, `+`/`-` poza numerem telefonu).
- `services/accessLogView.ts`: `accessLog.list` (filtry `userId`, `action`, `from`, `to`; `limit` 1–500, `offset`, `hasMore`; od najnowszych; nazwy użytkowników, osób i działań dociągane, zanonimizowana osoba = pusta etykieta) i `accessLog.exportCsv` (do 50 000 wpisów, czas polski `dd.mm.rrrr HH:mm:ss`, zdarzenia po polsku, wpis `export` / `access_log`). Daty filtrów to dni w Europe/Warsaw włącznie (`dayStart` w `common.ts`, test na zmianę czasu).
- `logAccess`: nowe zdarzenie `export`, nowe typy celu (`contacts_list`, `actions_list`, `participants_list`, `access_log`); rodzaj celu zapisywany także bez `targetId`.
- Testy `exports.test.ts` (18): uprawnienia, minimalne kolumny bez e-maili i telefonów, własne nazwy ról, filtry, Kosz i anonimizacja poza plikiem, brak szyfrogramu i notatek w CSV, formuły, wpisy w dzienniku bez filtra i nazwisk, uczestnicy, eksport osoby (PERSON_ONLY, 404, Kosz), dziennik (tylko admin, nazwy, filtry z granicami dni, strony, CSV, eksport widoczny w kolejnym eksporcie), `dayStart`. Test uprawnień obejmuje 4 nowe metody. Typecheck, 802 testy i build przechodzą.
- **Uwagi na etap b:** polskie nazwy do CSV są w `shared/exportLabels.ts` obok tych w `pl.ts` (serwer buduje plik, więc nie może importować z klienta); okno wyboru kolumn korzysta z `CONTACT_COLUMNS`, `CONTACT_COLUMNS_OPT_IN` (domyślnie niezaznaczone: e-mail, telefon, adres, miejscowość), `PARTICIPANT_COLUMNS`, `ACTION_COLUMNS`. Brak kodów komunikatów `PERSON_ONLY` dla eksportu w `pl.ts`. Eksport CSV ma limit tylko w dzienniku (50 000); listy osób i działań nie mają limitu.

### Krok 6, etap b (2026-11-15): ekrany eksportów i dziennika
- `components/ExportCsvDialog.tsx`: ostrzeżenie o danych osobowych w pliku, wybór kolumn (e-mail, telefon, adres, miejscowość domyślnie odznaczone), `exports.csv`, zapis z BOM w przeglądarce. Przycisk „Eksport CSV” w liście osób (z bieżącymi filtrami), liście działań (z filtrami) i w zakładce Uczestnicy działania; tylko `admin` i `staff` (`canWrite`).
- `components/PersonExportDialog.tsx` + przycisk „Eksport danych osoby” na karcie osoby: `contacts.exportData`, dane wrażliwe (`sensitive.reveal`, wpis w dzienniku) i nazwy dokumentów odszyfrowane kluczem z pamięci karty. Bez odblokowanych kluczy, bez slotu albo przy błędzie odszyfrowania eksport jest oznaczony jako niepełny (komunikat w oknie, pole `complete` w JSON, napis „EKSPORT NIEPEŁNY” w druku). JSON: `dane-osoby-<8 znaków id>-<data>.json`. Wydruk: blok `hidden print:block` w portalu, klasa `print-export` na `body` ukrywa resztę aplikacji (`styles.css`).
- `screens/AccessLogCard.tsx` w Ustawieniach (tylko `admin`): filtry użytkownik / zdarzenie / daty, tabela, „Pokaż starsze” (partie po 100), eksport CSV z bieżącymi filtrami.
- Typecheck, 802 testy i build przechodzą. **Niesprawdzone w przeglądarce** (kryteria 10, 11, 12 do przeklikania). Testów komponentów nie ma (jak w reszcie widoków).
- **Uwagi:** w JSON osoby dokumenty są tylko na liście (nazwa, typ, rozmiar), bez plików. Wpisy systemowe na osi są w JSON w surowej postaci, w druku jako „(zdarzenie systemowe)”. Teksty kolumn CSV w oknie pochodzą z `shared/exportLabels.ts`, nie z `pl.ts` (jedno źródło z serwerem). Eksport osoby zapisuje wpis `export` już przy otwarciu okna, także gdy użytkownik niczego nie pobierze.
