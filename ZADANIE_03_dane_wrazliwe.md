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
