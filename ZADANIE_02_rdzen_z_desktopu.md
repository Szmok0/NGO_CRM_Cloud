# ZADANIE 02 — Rdzeń z desktopu

Status: w realizacji (decyzje D1–D7 zatwierdzone przez MOC 2026-11-14) · Kontekst: `CLAUDE.md` (zasady danych 1–9), `NGO_CRM_CLOUD_KONCEPCJA.md` (4.2, 4.3, 4.8, 4.9, 7.2), `NGO_CRM_CLOUD_PROCESY_I_MODEL_DANYCH.md` (2.1, 2.3, 2.4, 2.6), `NGO_CRM_CLOUD_BEZPIECZENSTWO.md` (rozdział 4), ZADANIE_01 (zrobione 2026-11-14, ostatni commit `caafc84`) · Źródło: desktop `..\NGO_CRM` po ZADANIACH 01–02 (`src/shared`, `src/main/services`, `src/renderer`)

## Cel
Organizacja zalogowana do instancji w chmurze prowadzi w niej codzienną pracę tak jak w desktopie:
- osoby i instytucje z rolami, powiązaniami i zgodami,
- oś aktywności,
- działania z zajęciami, uczestnikami i obecnością,
- tematy szkoleń i zadania (lista i kanban),
- ekran „Dziś”, kalendarz z eksportem `.ics` i kosz.

Wygląd i zachowanie są jak w desktopie. Tożsamość osoby (imię, nazwisko, kontakt, adres) leży w osobnej tabeli. Reszta danych zna osobę tylko przez `contacts.id`. Każda metoda API ma role i obejmuje ją test uprawnień.

## Poza zakresem (nie rób)
- Dane wrażliwe (`contact_sensitive`), załączniki, nadawanie dostępu, maskowanie, dziennik odsłonięć, anonimizacja i eksport danych osoby to ZADANIE_03. Tabele `contacts` i `contact_identity` mają być jednak gotowe na anonimizację: znacznik `anonymizedAt` i usuwalny wiersz tożsamości.
- Kopie, karta kopii na „Dziś”, panel „Stan bezpieczeństwa” to ZADANIE_04. Na „Dziś” nie ma karty kopii.
- Działania v2 (etapy, osoba odpowiedzialna, przygotowanie, szablony, budżet, ewaluacja) oraz materiały i wiedza to ZADANIE_05. Pozycja menu „Wiedza” zostaje wyszarzona.
- Synchronizacja, praca offline i odświeżanie na żywo (koncepcja 4.3: dane pobierane przy wejściu i po zapisie).
- Import z Excela/CSV, własne pola, dokumenty z szablonów.

## Krok 0: przed kodem
1. Przeczytaj desktop: `src/shared/*` (typy, kontrakt `ipc.ts`, logika), `src/main/services/*` (bez `materials`, `knowledge`, `prep`, `team`), `src/main/db/schema.ts` (tabele domenowe), `src/renderer/views/*` i `components/*` (bez materiałów, przygotowania, budżetu, ewaluacji i synchronizacji) oraz `ZADANIE_01` i `ZADANIE_02` desktopu (kryteria akceptacji).
2. **Decyzje do potwierdzenia przez MOC:**
   - **D1. Kolumny `actions`:** tylko pola rdzenia z desktopowych ZADAŃ 01–02. Pola v2 (`responsibleUserId`, `templateId`) i tabele przygotowania dojdą migracją w ZADANIU_05, więc teraz nie powstanie martwy kod. **Propozycja: tak.**
   - **D2. Notatka o osobie (`notes`):** należy do tożsamości (`contact_identity`), jest jawna dla serwera i można po niej szukać. Notatki wrażliwe dojdą jako osobne pole w `contact_sensitive` (ZADANIE_03). To zamyka sprawę 2.7.6 z modelu danych. **Propozycja: tak.**
   - **D3. Klucze obce:** są, z `ON DELETE RESTRICT` (model 2.1.10). Pary `action_participants` (działanie, osoba) i `attendance` (zajęcia, osoba) mają `UNIQUE`. Powiązania `targetType` + `targetId` są bez klucza obcego. **Propozycja: tak.**
   - **D4. Uprawnienia:**
     - `readonly`: wszystkie odczyty i eksport `.ics`,
     - `staff`: dodatkowo wszystkie zapisy domenowe, w tym kosz (przywracanie),
     - `admin`: dodatkowo ustawienia organizacji (moduły, nazwy ról, liczba dni do „wymaga uwagi”).
     
     **Propozycja: tak.**
   - **D5. Usługi:** logika z `src/main/services` przepisana na asynchroniczne zapytania Drizzle (`mysql2`), każda operacja zapisu w jednej transakcji przez `repo.ts`. Zachowanie i komunikaty jak w desktopie. **Propozycja: tak.**
   - **D6. Dane demonstracyjne:** polecenie `npm run dev:demo` wypełnia **tylko lokalną bazę** fikcyjnymi danymi z desktopowego `vault.createDemo`, z tymi samymi blokadami co `dev:account` (odmawia poza lokalną bazą, przy `NODE_ENV=production` i przy nazwie bazy z hostingu). Na instancji próbnej MOC wpisuje kilka rekordów ręcznie. **Propozycja: tak.**
   - **D7. Bez nowych zależności.** Wszystko, czego używa desktop, już jest w Cloud. Krój Inter jest skopiowany. Desktopowe `ui.tsx` używa `class-variance-authority` (warianty przycisków i chipów), ale w Cloud zastępujemy je zwykłymi mapami klas, tak jak w obecnym `ui.tsx` (poprawka zatwierdzona przez MOC 2026-11-14). Przeciąganie w kanbanie zostaje na natywnym HTML5 drag & drop. **Propozycja: tak.**
3. Przedstaw MOC krótki plan kroku 1 i listę plików. **Czekaj na akceptację.**

## Zasady przenoszenia (dotyczą każdego kroku)
- **Kopiuj i dostosuj, nie pisz od nowa.** Zmieniaj tylko to, czego wymaga chmura:
  - transport (`window.api` → `src/client/lib/api.ts`),
  - asynchroniczne zapytania,
  - `version`,
  - podział tożsamości,
  - role,
  - CSP.
- **CSP:** atrybuty `style` są zablokowane (desktop ma je w 8 miejscach, m.in. `Avatar` w `ui.tsx`, paski postępu w zadaniach). Zastąp je klasami: stała paleta kolorów awatarów, szerokości pasków w krokach co 5% albo element `<progress>`/`<meter>`.
- **`version`:** każdy formularz edycji wysyła `version` rekordu. Przy konflikcie klient pokazuje komunikat „Ktoś zmienił ten rekord w międzyczasie” i odświeża dane.
- **Tożsamość:** listy, wyszukiwarka i nazwy na osi biorą imię i nazwisko z `contact_identity` przez jedno złączenie w usłudze. Pozostałe tabele nie kopiują nazwisk. Osoba bez wiersza tożsamości (po anonimizacji w ZADANIU_03) wyświetla się jako „Osoba zanonimizowana”.
- **`change_log`:** dla `contact_identity` zapisuj tylko nazwy zmienionych pól (zasada danych 8). Dotyczy to też `insert` i `delete`: wpis bez wartości.
- **Logi serwera:** bez parametrów wywołań, jak w ZADANIU_01. Nowe usługi niczego nie logują poza błędami (nazwa i kod).
- **Teksty** z desktopowego `i18n/pl.ts` dopisuj do `src/client/i18n/pl.ts`. Nie zostawiaj tekstów rozproszonych w widokach.
- **Testy:** testy logiki z desktopu (`src/shared/*.test.ts`, `renderer/lib/*.test.ts`) przenieś razem z kodem. Testy usług piszemy na lokalnej bazie testowej (`TEST_DATABASE_URL`).
- **Każdy krok:** a) serwer i testy, b) ekrany i sprawdzenie w przeglądarce, w tym na zbudowanej aplikacji pod CSP. Po każdym etapie commit i krótkie podsumowanie w „Wyniku”.

## Krok 1: wspólna podstawa
- `src/shared`: przenieś typy domeny i czystą logikę:
  - `types.ts`, `domain.ts`, `dates.ts`, `text.ts`, `csv.ts`,
  - `holidays.ts`, `calendar.ts`, `ics.ts`,
  - `feed.ts`, `stale.ts`, `attendanceStats.ts`, `pasteList.ts`,
  - testy do nich.
  
  Pomiń `cloudPath`, `prep*`, `budget`, `evaluation` i wszystko o synchronizacji.
- `src/server/db/repo.ts`: tryb „tylko nazwy pól” w `change_log` dla tabel tożsamości (konfiguracja per tabela), z testem.
- `src/client/components/ui.tsx`: brakujące komponenty z desktopu (karty, chipy, puste stany, okna dialogowe, `Avatar`) bez atrybutów `style`. Do tego `chips.tsx`, `lib/avatar.ts` (z testem), `lib/format.ts`, `lib/calendarUi.ts`, `lib/feedText.ts` (z testem).
- `src/client/lib/api.ts`: obsługa `VERSION_CONFLICT` w jednym miejscu (komunikat i odświeżenie widoku).
- Layout: pasek górny z desktopu (wyszukiwarka i „+ Utwórz”). Wyszukiwarka i tworzenie zaczną działać w kolejnych krokach, do tego czasu są ukryte.
- **Sprawdzenie:** `npm test` zielone (przeniesione testy logiki), w przeglądarce bez błędów CSP.

## Krok 2: osoby i instytucje
- Tabele (migracja):
  - `contacts` (`kind`, `tags`, `anonymizedAt`),
  - `contact_identity` (`contactId` UNIQUE, `firstName`, `lastName`, `name`, `email`, `phone`, `address`, `city`, `notes`; porównania `utf8mb4_polish_ci`),
  - `contact_roles`, `relationships`, `consents`.
- Usługi z desktopowego `contacts.ts`:
  - lista z filtrami (rodzaj, rola, tag, tekst),
  - karta osoby,
  - tworzenie i edycja (`contacts` i `contact_identity` w jednej transakcji, jedna `version` na rekord każdej tabeli),
  - usuwanie oznaczeniem,
  - tagi, duplikaty (po tożsamości),
  - role (dodaj, zakończ, usuń), powiązania, zgody (dodaj, wycofaj, usuń).
- Metody RPC jak w desktopowym `ipc.ts` (`contacts.*`, `roles.*`, `relationships.*`, `consents.*`) z rolami wg D4. Do tego `search.global` (osoby po tożsamości; działania, tematy i zadania dojdą w swoich krokach).
- Ekrany: `ContactsList`, `ContactCard` (na razie bez osi), `ContactForm`, `ContactPicker`, wyszukiwarka w pasku górnym, „+ Utwórz” → Osoba / Instytucja.
- **Testy:**
  - wpis w `change_log` dla tożsamości bez wartości,
  - konflikt wersji przy równoczesnej edycji,
  - duplikaty,
  - lista nie zwraca usuniętych,
  - `readonly` nie zapisze (403).

## Krok 3: oś aktywności
- Tabele: `activities` (`content` jako `text`), `activity_contacts`.
- Usługi i RPC: `activities.add`, `activities.delete`; oś na karcie osoby i (od kroku 4) na działaniu. Wpisy systemowe z JSON-em zdarzenia w `content`, tekst po polsku składa klient (`Timeline.tsx`).
- Ekrany: `ActivityForm` (notatka, kontakt, wsparcie z formą i czasem), `Timeline`, szybkie akcje na karcie osoby (Notatka, Kontakt, Wsparcie).
- **Testy:** wpis z kilkoma osobami, usunięcie oznaczeniem, wpis systemowy przy zmianie roli.

## Krok 4: tematy i działania
- Tabele:
  - `topics`,
  - `actions` (kolumny wg D1),
  - `action_sessions` (desktopowe `sessions`),
  - `action_participants` i `attendance` (`UNIQUE` wg D3).
- Usługi z desktopowego `actions.ts` (bez v2):
  - lista z filtrami, szczegóły z podsumowaniem (uczestnicy, frekwencja, liczba zajęć),
  - tworzenie i edycja, zmiana statusu, usuwanie oznaczeniem,
  - zajęcia (dodaj, edytuj, usuń),
  - uczestnicy (dodaj, status, usuń, wklejenie listy z podglądem),
  - obecność (ustaw).
  
  Tematy: lista, szczegóły, CRUD.
- Ekrany:
  - `ActionsList`, `ActionDetail` (zakładki z ZADANIA_02 desktopu: przegląd, uczestnicy, zajęcia i obecność, oś), `ActionForm`, `ActionHeader` bez pasków v2, `PasteDialog`,
  - `TopicsView`,
  - wydruk listy obecności z przeglądarki (`AttendanceSheet` + style `@media print`, zamiast `print.attendance` z Electrona).
- `search.global` obejmuje działania i tematy.
- **Testy:**
  - drugi zapis tej samej pary uczestnika lub obecności nie tworzy duplikatu,
  - statystyka frekwencji,
  - wklejenie listy (dopasowanie po tożsamości),
  - działanie odwołane znika z kalendarza (sprawdzane w kroku 6).

## Krok 5: zadania
- Tabele: `tasks` (`assigneeUserId` → `users.id`, `targetType` + `targetId`), `task_items`.
- Usługi i RPC: lista (moje, wszystkie, wg działania lub osoby), szczegóły, CRUD, `tasks.move` (status), checklisty (dodaj, odhacz, usuń). Przypisywać można tylko aktywnych użytkowników.
- Ekrany: `TasksView` (lista i kanban z przeciąganiem i przyciskami ←/→), `TaskDialog`, `TaskRows`; zadania na karcie osoby i działania; „+ Utwórz” → Zadanie, Notatka, Działanie.
- `search.global` obejmuje zadania.
- **Testy:** przesunięcie w kanbanie zmienia status i zapisuje wpis w `change_log`, postęp checklisty, przypisanie do wyłączonego konta jest odrzucane.

## Krok 6: „Dziś”, kalendarz, kosz, ustawienia organizacji
- **„Dziś”** (desktopowe `overview.ts` i `TodayView.tsx`):
  - powitanie i kafelki,
  - „Mój dzień” (zaległe, na dziś, kółko do odhaczenia z cofnięciem), najbliższe dni,
  - mini-kalendarz,
  - „Wymaga uwagi” (z przyciskiem „Dodaj kontakt”),
  - „Ostatnio w organizacji” z `change_log`: imiona z `users` i `contact_identity`, łączenie serii, bez zmian ustawień i wpisów technicznych.
  
  Bez karty kopii. Licznik przy „Zadaniach” w menu (`today.counter`).
- **Kalendarz** (desktopowe `calendar.ts` i `CalendarView.tsx`):
  - widoki miesiąc, tydzień i lista,
  - wpisy: zajęcia, działania, terminy zadań, koniec zbiórki, polskie święta,
  - filtry zapamiętane w `localStorage` (tylko wygoda, bez danych),
  - „+N więcej”, klik pustego dnia → tworzenie z datą, panel boczny.
- **Eksport `.ics`:** plik budowany w przeglądarce z `calendar.entries` (`ics.ts` z `src/shared`) i pobierany przez link do pobrania. Bez danych osobowych uczestników, `UID` = `{id}@ngo-crm`, strefa `Europe/Warsaw`. Bez nowej trasy na serwerze.
- **Kosz:** lista usuniętych rekordów (osoby, działania, tematy, zadania, wpisy), przywracanie przez `repo.restore` z nową `version`.
- **Ustawienia organizacji** (tylko `admin`, nowa zakładka w `SettingsScreen`): nazwa organizacji, profil, włączone moduły, własne nazwy ról, liczba dni do „wymaga uwagi”. Używa istniejącej tabeli `settings`. Moduły wyłączone ukrywają widoki, dane zostają.
- Menu: pozycje z ZADANIA_02 aktywne wg modułów, „Wiedza” zostaje wyszarzona do ZADANIA_05.
- **Testy:**
  - z desktopu: wpisy kalendarza (pomijanie odwołanych i usuniętych, tydzień od poniedziałku), święta 2025–2027, `.ics` (zawijanie, escapowanie, `UID`, strefa, zadania całodniowe), feed (zdania i serie),
  - nowe: przywrócenie z kosza, ustawienia tylko dla `admin`.

## Krok 7: dane demonstracyjne, scenariusz akceptacji, wdrożenie
- `npm run dev:demo` wg D6. Dane fikcyjne z desktopu, kalendarz z wpisami w bieżącym i następnym miesiącu.
- `src/server/acceptance.test.ts`: scenariusz akceptacji z desktopu przepisany na RPC. Przechodzi przez wszystkie moduły, także jako `readonly` (odmowy zapisu).
- Wdrożenie na Hostinger (`git push`):
  - migracje przy starcie,
  - przeklikanie kryteriów na instancji próbnej (tylko dane fikcyjne),
  - nagłówki i konsola bez błędów CSP,
  - czas odpowiedzi list przy ok. 200 osobach z demo.
- `npm audit`.

## Kryteria akceptacji (scenariusz do przeklikania)
1. `npm run typecheck`, `npm test` i `npm run build` przechodzą bez błędów. Test uprawnień obejmuje wszystkie nowe metody.
2. Zakładam osobę i instytucję, nadaję role, dodaję powiązanie i zgodę. Osoba jest w liście, w wyszukiwarce i na karcie.
3. W bazie (`change_log`) zmiana nazwiska ma tylko nazwę pola. W `contacts`, `activities`, `tasks` i `attendance` nie ma imion ani nazwisk.
4. Ta sama osoba otwarta w dwóch przeglądarkach: druga zapisana zmiana dostaje „Ktoś zmienił ten rekord w międzyczasie” i widzi aktualne dane.
5. Dodaję notatkę, kontakt i wsparcie. Wpisy są na osi osoby. Przy osobie w „Wymaga uwagi” „Dodaj kontakt” usuwa ją z listy.
6. Zakładam szkolenie z tematem, 3 zajęciami i uczestnikami (także przez wklejenie listy). Zaznaczam obecność. Frekwencja się zgadza, a lista obecności drukuje się z przeglądarki.
7. Zadanie przez „+ Utwórz” pojawia się w „Mój dzień” i w „Ostatnio w organizacji”. Przeciągnięcie w kanbanie zmienia status. Kółko na „Dziś” odhacza je i cofa odhaczenie.
8. Kalendarz pokazuje zajęcia, działania, terminy zadań i święta (np. 11 listopada). Filtry i widoki działają. Klik pustego dnia tworzy zadanie z tą datą.
9. Plik `.ics` importuje się do Google Calendar lub Outlooka z poprawnymi godzinami. Ponowny import nie dubluje wpisów.
10. Usuwam osobę, działanie i zadanie. Są w Koszu i dają się przywrócić.
11. Konto `readonly` widzi wszystko, ale nie zapisze niczego (przyciski ukryte, serwer 403). Konto `staff` nie zmieni ustawień organizacji.
12. Na Hostingerze wszystko działa po HTTPS, konsola jest bez błędów CSP, a logi serwera bez imion, e-maili i parametrów.
13. Przy oknie 1024 px menu zwija się do ikon i nic nie wychodzi poza ekran. Całe UI jest po polsku i obsługiwane z klawiatury.
14. Commit i `git push` po akceptacji MOC.

## Po zakończeniu
Krótkie podsumowanie dla MOC w „Wyniku”:
- co przeniesiono,
- odstępstwa od desktopu i powody,
- co trzeba przenieść z desktopu przy kolejnych zmianach,
- otwarte sprawy na ZADANIE_03.

Nie aktualizuj Sejfu bez zgody MOC.

## Wynik

### Krok 1, etap a: logika wspólna i warstwa zapisu (2026-11-14)
- `src/shared`: przeniesione z desktopu `domain.ts`, `dates.ts`, `text.ts`, `csv.ts`, `holidays.ts`, `calendar.ts`, `ics.ts`, `feed.ts`, `stale.ts`, `attendanceStats.ts`, `pasteList.ts` z testami (`calendar.test.ts`, `ics.test.ts`, `logic.test.ts`; 29 testów).
- Dostosowania:
  - `domain.ts`: bez słowników v2 i materiałów (wrócą w ZADANIU_05) oraz bez ról użytkowników i profili (są już w `api.ts` i `modules.ts`); `OP_TYPES` z `anonymize`;
  - `feed.ts`: tabela zajęć to `action_sessions`; bez notatek wiedzy i plików.
- `repo.ts`: `NAMES_ONLY_TABLES` (`contact_identity`, `contact_sensitive`) — `change_log` zapisuje dla nich same nazwy pól (`{ pole: true }`), także przy `insert`, usunięciu i przywróceniu. Test w `repo.test.ts`.
- `typecheck` i `npm test` (272) bez błędów.
- Do kroku 6: zmiana samej tożsamości (`contact_identity`) nie trafia jeszcze do „Ostatnio w organizacji” jako „zmienił dane osoby”; dopisać przy podłączaniu feedu.

### Krok 1, etap b: interfejs (2026-11-14, sprawdzenie w przeglądarce 2026-11-15)
- `components/ui.tsx`: komponenty desktopu (`Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Field`, `Card`, `Badge`, `Alert`, `Avatar`, `EmptyState`, `Dialog`, `Tabs`, `Segmented`, `Table`, `PageHeader`, `Empty`, `ErrorText`) z wariantami jako mapy klas (bez cva) i bez `style`. `Avatar`: rozmiary jako klasy, kolor przez `avatarClass` (test zgodności z paletą). Zostały pomocnicze ekranów logowania: `AuthCard` (dawny `Card`), `InputField` (dawny `Field`), `SelectField`, `ErrorNote`, `InfoNote`; przycisk `danger` (obramowany) dodany do wariantów desktopu.
- `components/chips.tsx`, `lib/avatar.ts`, `lib/feedText.ts`, `lib/calendarUi.ts`, `lib/format.ts` z desktopu (z testami `avatar`, `feedText`); bez `formatSize` i zdań o plikach/notatkach.
- `app/context.tsx`: kontekst jak w desktopie (sesja z kontem i ustawieniami, trasy `today`/`settings`, nazwy ról, moduły, wylogowanie). Nowa metoda RPC `settings.get` (wszystkie role) i `server/services/settings.ts`.
- `lib/api.ts`: `VERSION_CONFLICT` obsłużony w jednym miejscu (wszystkie `useLoad` wczytują dane od nowa, formularz pokazuje komunikat).
- `i18n/pl.ts`: wspólne sekcje i słowniki z desktopu; role użytkowników przemianowane na `pl.userRoles` (`pl.roles` = role kontaktów jak w desktopie); nazwy w menu jak w desktopie.
- `styles.css`: brakujące tokeny (`orange`, `violet-strong`, kolory obecności), tło okien dialogowych.
- 7 ekranów i `Layout` dopasowane do nowych nazw komponentów (wygląd bez zmian, `Panel` w ustawieniach zastąpiony `Card`).
- `typecheck`, `npm test` (288) i `npm run build` bez błędów.
- Sprawdzone w przeglądarce na zbudowanej aplikacji (`npm start`, lokalnie): logowanie, konfiguracja 2FA, „Dziś”, ustawienia z listą użytkowników i formularzem zaproszenia, menu zwinięte i rozwinięte. Awatary mają kolory z klas. Konsola bez błędów CSP. Kreatora nie przechodzono ponownie (lokalna baza ma już konto).
- Usterka złapana w przeglądarce (poprawiona): konto z `npm run dev:account` nie miało ustawień organizacji (zakłada je kreator), więc `settings.get` zwracało 404, a klient pokazywał „Brak połączenia”. `dev:account` zakłada teraz brakujący wiersz `settings` (organizacja próbna, profil „projekty”).

### Krok 2, etap a: osoby i instytucje — serwer (2026-11-15)
- Tabele (migracja `0006`): `contacts` (`kind`, `tags`, `anonymizedAt`), `contact_identity` (`contactId` UNIQUE), `contact_roles`, `relationships`, `consents`; klucze obce do `contacts` z `ON DELETE RESTRICT` (D3); daty jako `date`.
- `shared/types.ts`: typy wyników API pisane wprost (znaczniki czasu jako ISO, kontakt z tożsamością i `identityVersion`), bez wyprowadzania ze schematu bazy.
- `server/services/common.ts` (aktor, `repoFor`, `meta`, kontakt z tożsamością jednym złączeniem) i `server/services/contacts.ts` przeniesione z desktopu: lista z filtrami i sortowaniem po polsku, tagi, duplikaty, karta osoby (role, powiązania, zgody), tworzenie (kontakt + tożsamość + role w jednej transakcji), edycja (`version` kontaktu i tożsamości), usuwanie oznaczeniem, role, powiązania, zgody, wyszukiwarka globalna (po tożsamości).
- RPC: 16 metod (`contacts.*`, `roles.*`, `relationships.*`, `consents.*`, `search.global`); odczyt wszystkie role, zapis `admin` i `staff` (D4). Każdy zapis podrzędny wymaga `id` i `version`.
- Testy: `services/contacts.test.ts` (9): tożsamość poza `contacts`, `change_log` tożsamości bez wartości, konflikt wersji, walidacja, filtry i sortowanie, usunięci poza listą i wyszukiwarką, duplikaty, role/powiązania/zgody, brak zapisu do usuniętej osoby. Test uprawnień obejmuje nowe metody. Razem 377.
- Usterka złapana testem: edycja zapisywała do tożsamości każde pole z parametrów (w RPC zod je obcina, ale usługa nie powinna na tym polegać) — teraz bierze tylko pola tożsamości.
- **Odstępstwa:**
  - porównania `utf8mb4_polish_ci` nie ustawiono w bazie: sortowanie i wyszukiwanie robi serwer w JS (`localeCompare('pl')`, `matchesQuery`), jak w desktopie;
  - karta osoby nie ma jeszcze udziału w działaniach, zadań ani osi (kroki 3–5); wpis systemowy „dodano osobę” dojdzie z osią (krok 3).

### Krok 2, etap b: osoby i instytucje — ekrany (2026-11-15)
- `views/contacts/ContactsList.tsx`, `ContactCard.tsx`, `ContactForm.tsx`, `components/ContactPicker.tsx` przeniesione z desktopu; zapisy odsyłają `version` (kontakt, tożsamość, role, powiązania, zgody), błędy akcji (np. konflikt wersji) pokazuje karta.
- Pasek górny: przycisk „Wstecz”, wyszukiwarka globalna (osoby i instytucje), „+ Utwórz” → Osoba / Instytucja. Menu: „Osoby i instytucje” aktywne.
- Rola `readonly`: bez przycisków zapisu (`canWrite` w kontekście); serwer i tak odmawia (test uprawnień).
- Sprawdzone w przeglądarce na zbudowanej aplikacji: założenie osoby z rolą i tagami przez „+ Utwórz”, edycja (telefon), dodanie zgody, lista z rolą i tagami, wyszukiwarka. Konsola bez błędów CSP.
- **Odstępstwa:**
  - bez eksportu CSV listy: eksport danych osobowych ma mieć ostrzeżenie i wpis w dzienniku dostępu (ZADANIE_03);
  - na karcie nie ma jeszcze szybkich akcji Notatka / Kontakt / Wsparcie / Zadanie, udziału w działaniach ani dokumentów (kroki 3–5, załączniki w ZADANIU_03).
- Drobiazg z desktopu (zostawiony): wyszukiwarka przez ułamek sekundy pokazuje „Nic nie znaleziono”, zanim przyjdą wyniki.

### Krok 3, etap a: oś aktywności — serwer (2026-11-15)
- Tabele (migracja `0007`): `activities` (`occurredAt` jako `datetime(3)`, `actionId` bez klucza obcego do kroku 4), `activity_contacts` (klucze obce do `activities` i `contacts`).
- `server/services/activities.ts`: `addActivity` (osoby muszą istnieć i nie być usunięte; notatka bez kanału i czasu, kanał tylko przy kontakcie, forma tylko przy wsparciu), `deleteActivity` (oznaczenie; wpisu systemowego nie da się usunąć), `loadActivities` (autor, osoby jednym złączeniem z tożsamością), `addSystemActivity`.
- Założenie osoby dopisuje wpis systemowy `contact_created` (jak w desktopie). Karta osoby (`contacts.get`) zwraca oś.
- RPC: `activities.add`, `activities.delete` (`admin`, `staff`). Powiązanie wpisu z działaniem (`actionId`) dojdzie w kroku 4.
- Testy: 5 nowych (wpis systemowy, wpis z kilkoma osobami, pola zależne od rodzaju, usuwanie i blokada wpisu systemowego, osoba usunięta/nieistniejąca). Razem 392.
- **Odstępstwo od opisu kroku:** test „wpis systemowy przy zmianie roli” zastąpiony testem wpisu przy założeniu osoby — desktop nie zapisuje zmian ról na osi, a to zadanie przenosi zachowanie desktopu.

### Krok 3, etap b: oś aktywności — ekrany (2026-11-15)
- `components/ActivityForm.tsx` (formularz na osi i okno z wyborem osoby) i `components/Timeline.tsx` przeniesione z desktopu; usunięcie wpisu odsyła `version`, błąd widać na osi.
- Karta osoby: szybkie akcje Notatka / Kontakt / Wsparcie, oś aktywności w prawej kolumnie (układ jak w desktopie). Bez przycisków zapisu dla `readonly` i dla osoby usuniętej.
- „+ Utwórz” → Notatka, Kontakt (wybór osoby, po zapisie przejście na jej kartę).
- Sprawdzone w przeglądarce na zbudowanej aplikacji: wpis kontaktu z „+ Utwórz” (kanał, czas), notatka z osi na karcie; konsola bez błędów CSP. Usuwania wpisu nie klikano (okno potwierdzenia przeglądarki); jest w testach serwera.
- Znane: gdy „+ Utwórz” doda wpis osobie, której karta jest właśnie otwarta, karta odświeży się dopiero po ponownym wejściu (jak w desktopie; widoki odświeżają się po własnych zapisach).

### Krok 4, etap a: tematy i działania — serwer (2026-11-15)
- Tabele (migracja `0008`): `topics`, `actions` (pola rdzenia wg D1), `action_sessions`, `action_participants` (UNIQUE `action_id`+`contact_id`), `attendance` (UNIQUE `session_id`+`contact_id`); klucz obce do działań, osób i tematów; `activities.action_id` dostał klucz obcy do `actions`.
- `server/services/actions.ts` (z desktopowych `actions.ts` i części `tasks.ts`): tematy (lista, karta z działaniami, CRUD), działania (lista z filtrami typu/statusu/ram/okresu/tekstu, szczegóły z uczestnikami, zajęciami, obecnością, frekwencją i osią; tworzenie, edycja z wpisem systemowym przy zmianie statusu, usuwanie), uczestnicy (dodanie z przywróceniem wcześniej usuniętej pary, status, usunięcie, podgląd i zapis wklejonej listy — nowe osoby z tożsamością i rolą uczestnika), zajęcia (z prowadzącym), obecność.
- Obecność z blokadą optymistyczną: klient odsyła wersję zaznaczenia, które widział (`null` = puste); inny stan w bazie → `VERSION_CONFLICT`. Równoczesne dodanie tej samej pary (UNIQUE) → też `VERSION_CONFLICT` zamiast błędu 500.
- Oś: wpisy przy działaniu (także bez osób), tytuł działania przy wpisie; osoby przy wpisie posortowane po nazwie. Karta osoby: udział w działaniach. Wyszukiwarka: działania i tematy.
- RPC: 19 nowych metod (odczyt wszystkie role, zapis `admin`/`staff`; podgląd wklejonej listy też tylko zapis, bo służy dodawaniu).
- Testy: `services/actions.test.ts` (8): temat tylko przy szkoleniu, wpis o zmianie statusu i konflikt wersji, filtry listy i wyszukiwarka, para uczestnika bez duplikatu i przywrócenie, wklejona lista (dopasowanie, sprzeczny e-mail, nowe osoby), frekwencja, konflikt i ponowne zaznaczenie obecności bez duplikatu, wpis na osi działania bez osób. Razem 495.
- **Odstępstwa (D1):** bez `actions.setStatus` (pasek etapów), `actions.shiftTasks` (zadania w kroku 5) i filtra „moje” (osoba odpowiedzialna) — to elementy działań v2.

### Krok 4, etap b: tematy i działania — ekrany (2026-11-15)
- `views/actions/ActionsList.tsx`, `ActionForm.tsx`, `ActionDetail.tsx`, `PasteDialog.tsx`, `AttendanceSheet.tsx` i `views/TopicsView.tsx` przeniesione z desktopu bez elementów działań v2 (osoba odpowiedzialna, pasek etapów, odwołanie przyciskiem, przesuwanie zadań, przygotowanie, budżet, ewaluacja, pliki i notatki — D1). Zapisy odsyłają `version`, obecność odsyła wersję zaznaczenia.
- Szczegóły działania: nagłówek, pasek podsumowań (uczestnicy, frekwencja, zajęcia; szerokość pasków klasami co 10%, bo CSP blokuje `style`), zakładki Informacje / Uczestnicy / Zajęcia i obecność / Historia (oś działania z wpisami bez osób).
- Lista obecności: arkusz w stronie widoczny tylko przy drukowaniu (`hidden print:block`), reszta ekranu `print:hidden`; przycisk „Lista obecności (druk)” → okno drukowania przeglądarki (zamiast PDF z Electrona).
- Menu: „Działania” i „Tematy szkoleń” aktywne (ukryte przy wyłączonym module „actions”). Wyszukiwarka prowadzi do działań i tematów. „+ Utwórz” → Działanie. Karta osoby: „Udział w działaniach”. Oś osoby: link do działania przy wpisie.
- Sprawdzone w przeglądarce na zbudowanej aplikacji: temat, szkolenie z tematem przez „+ Utwórz”, wklejenie listy 3 osób (1 dopasowana, 2 nowe), zajęcia, klikanie obecności (frekwencja 33%, pasek podsumowań), konsola bez błędów CSP; arkusz do druku obecny w stronie i ukryty na ekranie, reguły `@media print` w zbudowanym CSS. Okna drukowania nie otwierano (nie da się w tym narzędziu).
- **Do sprawdzenia przez MOC:** wydruk listy obecności z przeglądarki (orientacja strony: desktop drukował A4 poziomo; tu domyślna przeglądarki).

### Krok 5, etap a: zadania — serwer (2026-11-15)
- Tabele (migracja `0009`): `tasks` (`assigneeUserId` → `users`, „dotyczy” przez `targetType` + `targetId` bez klucza obcego), `task_items` (→ `tasks`).
- `server/services/tasks.ts` z desktopu: lista (moje / przy osobie / przy działaniu; zadania działania w Koszu znikają z listy ogólnej), szczegóły z checklistą, tworzenie z checklistą, edycja, `tasks.move` (kanban), usuwanie, pozycje checklisty (dodaj, odhacz, usuń). Każdy zapis z `version`.
- Nowe względem desktopu: przypisać można tylko aktywnego użytkownika (inaczej `VALIDATION`); „dotyczy” musi wskazywać nieusuniętą osobę lub działanie (`NOT_FOUND`); metoda `users.options` (imię i id aktywnych użytkowników dla wszystkich ról, bo `users.list` jest tylko dla administratora i zawiera e-maile).
- Karta osoby i szczegóły działania zwracają swoje zadania.
- Testy: `services/tasks.test.ts` (6): checklista i postęp, odhaczanie z wersją, kanban zmienia status i zapisuje `change_log`, konflikt wersji, tylko aktywni użytkownicy, „moje”, sortowanie, zadania przy osobie i działaniu, działanie w Koszu, „dotyczy” usuniętej osoby, usuwanie. Razem 551.
- **Odstępstwo od opisu kroku:** wyszukiwarka globalna nie obejmuje zadań (desktop ich nie szuka; zadania są w widoku Zadania i na kartach).

### Krok 5, etap b: zadania — ekrany (2026-11-15)
- `components/TaskDialog.tsx`, `components/TaskRows.tsx` (tabela i karta „Zadania”), `views/tasks/TasksView.tsx` (kanban i lista) przeniesione z desktopu; zapisy z `version` (zadanie, pozycje checklisty, kanban). Osoba odpowiedzialna z `users.options`. Dla `readonly` okno zadania tylko do odczytu, kanban bez przeciągania i strzałek.
- Pasek postępu checklisty klasami (`lib/bar.ts`, wspólne z paskiem podsumowań działania).
- Karta osoby: zadania i szybka akcja „Zadanie”. Działanie: zadania w zakładce Informacje. Menu: „Zadania” (moduł „tasks”). „+ Utwórz” → Zadanie (po zapisie widok Zadania).
- Sprawdzone w przeglądarce na zbudowanej aplikacji: zadanie z checklistą przy szkoleniu (termin, wysoki priorytet), odhaczenie pozycji (1/3 na liście pod oknem), kanban: przesunięcie strzałką do „W trakcie”, pasek postępu; konsola bez błędów CSP.
- **Nie sprawdzono w przeglądarce:** przeciągania karty myszą — narzędzie symuluje ruchy myszy, z których przeglądarka nie uruchamia natywnego przeciągania HTML5. Kod przeciągania jak w desktopie; zmiana statusu (`tasks.move`) jest w testach serwera. **Do przeklikania przez MOC.**
- Licznik zadań przy „Zadaniach” w menu dojdzie z ekranem „Dziś” (krok 6).
