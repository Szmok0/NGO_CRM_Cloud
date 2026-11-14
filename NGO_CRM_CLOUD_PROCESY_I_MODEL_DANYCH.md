---
typ: projekt techniczny
projekt: NGO_CRM Cloud
wersja: 0.1
status: procesy jak w desktopie (hipotezy do wywiadów); model danych dostosowany do serwera i szyfrowania
aktualizacja: 2026-11-14
---

# NGO_CRM Cloud — mapa procesów i model danych

Źródło: `..\NGO_CRM\NGO_CRM_PROCESY_I_MODEL_DANYCH.md` (v0.1) i schemat działającego prototypu desktopowego (`..\NGO_CRM\src\main\db\schema.ts`, stan po ZADANIU_05). Procesy są wspólne dla obu wersji; różnice dotyczą modelu danych (część 2) i są zaznaczone.

---

## Część 1. Mapa procesów

Każdy proces: kroki, moduły, co program robi sam (automaty), pytania do wywiadów.

### PR1. Organizacja wydarzenia

| # | Krok | Moduł | Automat |
|---|---|---|---|
| 1 | Pomysł → nowe działanie (typ: wydarzenie), data, miejsce, „w ramach czego” | Działania | — |
| 2 | Checklista z szablonu (np. „festyn”) | Zadania | zadania z terminami liczonymi od daty wydarzenia |
| 3 | Kto pomaga: przydział wolontariuszy | Wolontariat | widok dostępności |
| 4 | Sprzęt i sala | Zasoby | ostrzeżenie o kolizji rezerwacji |
| 5 | Promocja: publikacje w kalendarzu treści | Media | wykrywanie luk i kolizji |
| 6 | Dzień wydarzenia: lista obecności, zdjęcia | Działania, Dokumenty | lista obecności do druku; zdjęcia oznaczone zgodami |
| 7 | Po: podsumowanie, godziny wolontariuszy, podziękowania | Działania, Wolontariat | zaświadczenia wolontariackie z godzin |
| 8 | Wnioski na przyszłość | Baza wiedzy | notatka przypięta do działania |
| 9 | Wpis do doświadczenia organizacji | Portfolio | automatycznie z działania |

### PR2. Szkolenie (projektowe lub odpłatne)

| # | Krok | Moduł | Automat |
|---|---|---|---|
| 1 | Nowe działanie typu „szkolenie”, temat z katalogu, „w ramach czego” | Działania | podpowiedź z poprzednich edycji |
| 2 | Odpłatne: zapytanie → oferta → zlecenie | Działania (ścieżka odpłatna) | oferta z szablonu |
| 3 | Trener, sala, terminy zajęć | Działania, Zasoby | kolizje trenera i sali |
| 4 | Rekrutacja uczestników | Osoby, Projekty | — |
| 5 | Realizacja: obecność na każdych zajęciach | Działania | — |
| 6 | Ewaluacja (ankieta) | Raporty | podsumowanie wyników |
| 7 | Zaświadczenia | Dokumenty | dla osób z wymaganą obecnością |
| 8 | Odpłatne: „do zafakturowania” | Działania | przypomnienie; faktura poza CRM |
| 9 | Portfolio | Portfolio | automatycznie |

### PR3. Od naboru do zamknięcia projektu

| # | Krok | Moduł | Automat |
|---|---|---|---|
| 1 | Nabór: źródło, termin, link, decyzja „składamy / nie” | Projekty (nabory) | przypomnienie przed terminem |
| 2 | Wniosek: status, odpowiedzialni | Projekty (nabory) | podpowiedzi z portfolio |
| 3 | Ocena → umowa / odrzucenie (z powodem) | Projekty (nabory) | powód odrzucenia do bazy wiedzy |
| 4 | Projekt z szablonu: rama, działania, wskaźniki, terminy | Projekty | — |
| 5 | Realizacja: działania, uczestnicy, wsparcie | Działania, Uczestnicy | wskaźniki liczone z danych |
| 6 | Terminy: sprawozdania, transze, kontrole | Projekty, Kalendarz | przypomnienia |
| 7 | Sprawozdanie: zestawienia do przepisania | Raporty | eksport (liczby, listy, działania), domyślnie bez danych identyfikujących |
| 8 | Zamknięcie i trwałość | Projekty | przypomnienie o końcu trwałości i retencji danych |
| 9 | Wnioski po projekcie | Baza wiedzy, Portfolio | — |

### PR4. Ścieżka uczestnika

| # | Krok | Moduł | Automat |
|---|---|---|---|
| 1 | Zgłoszenie: osoba w bazie (lub nowa), rola „uczestnik” | Osoby, Projekty | wykrywanie duplikatów (po tożsamości, na serwerze) |
| 2 | Kwalifikacja: checklista kryteriów grupy docelowej | Projekty | — |
| 3 | Zgody i klauzule RODO | Ustawienia/RODO, Dokumenty | dokumenty z szablonu |
| 4 | Karta uczestnika: dane wrażliwe (tylko jeśli włączone) | Uczestnicy | **szyfrowanie w przeglądarce, maskowanie, dziennik dostępu** |
| 5 | Wsparcie: wpisy aktywności (forma, czas, specjalista) | Uczestnicy, oś aktywności | — |
| 6 | Monitoring | Raporty | flaga „brak wsparcia od X dni” |
| 7 | Zakończenie udziału (powód) | Projekty | — |
| 8 | Monitoring po udziale | Projekty, Zadania | przypomnienie po N miesiącach |
| 9 | Retencja: anonimizacja po okresie | Ustawienia/RODO | przypomnienie; anonimizacja fizycznie usuwa tożsamość i dane wrażliwe |

### PR5. Wolontariusz
Zgłoszenie → porozumienie wolontariackie (i NNW) → checklista wprowadzenia → przydziały do działań → godziny → zaświadczenie → zakończenie współpracy.
Automaty: przypomnienie o wygasającym porozumieniu, zaświadczenie z sumy godzin, lista „kto nie był aktywny od pół roku”.

### PR6. Rok organizacyjny
Członkowie → składki → zebrania → protokoły i uchwały → sprawozdania → zmiany w KRS. Bez wbudowanych terminów ustawowych: każda organizacja wpisuje swoje.

### PR7. Zbiórka i kampania
Plan kampanii → zgłoszenie zbiórki → publikacje → rejestr wpłat i darczyńców (bez księgowości) → podziękowania → sprawozdanie.
Automaty: lista „nie podziękowano”, przypomnienie o sprawozdaniu.

### PR8. Dzień pracy
Ekran „Dziś”: zadania na dziś i zaległe, terminy w 7 dni, działania w tym tygodniu, flagi, **zmiany innych osób od ostatniego logowania** (z `change_log`, zamiast „po synchronizacji” w desktopie).

### PR9. Dostęp do programu (nowy, tylko w chmurze)

| # | Krok | Kto | Automat |
|---|---|---|---|
| 1 | Zaproszenie nowej osoby (e-mail, rola) | administrator | jednorazowy link ważny 72 h |
| 2 | Ustawienie hasła i 2FA | nowa osoba | para kluczy tworzona w przeglądarce |
| 3 | Nadanie dostępu do danych wrażliwych (jeśli potrzebny) | administrator | slot klucza, wpis w dzienniku dostępu |
| 4 | Praca | wszyscy | wylogowanie po bezczynności, blokada danych wrażliwych po bezczynności |
| 5 | Odejście osoby: wyłączenie konta | administrator | koniec wszystkich sesji, usunięcie slotów, propozycja zmiany klucza organizacji |
| 6 | Przegląd raz na kwartał | administrator | panel „Stan bezpieczeństwa”: kto ma dostęp, kto nie ma 2FA, nieaktywne konta |

---

## Część 2. Model danych

### 2.1 Zasady (różnice wobec desktopu oznaczone **[chmura]**)

1. Wszystkie encje domenowe mają: `id` (UUID, `char(36)`), `createdAt`, `updatedAt`, `updatedBy`, `deletedAt`. **[chmura]** Do tego `version` (blokada optymistyczna). **Bez** `deviceId`.
2. **Jedna baza kontaktów** (wzór CiviCRM): `Contact` z rodzajem `person` / `institution`.
3. **Role zamiast osobnych baz:** uczestnik, wolontariusz, darczyńca, członek, partner, trener, pracownik.
4. **Oś aktywności:** uniwersalny `Activity`.
5. **Powiązania wieloznaczne:** `targetType` + `targetId`.
6. **Pola własne:** definicje w `CustomFieldDef`, wartości w kolumnie JSON encji.
7. **Wskaźniki liczone, nie przepisywane.**
8. **[chmura] Trzy strefy:** `contacts` (bez danych identyfikujących) → `contact_identity` (jawne dla serwera w wersji 1) → `contact_sensitive` (szyfrogram z przeglądarki).
9. **Moduł wyłączony = ukryte widoki**, dane zostają.
10. **[chmura] Bez kluczy obcych w bazie?** W desktopie zrezygnowano z nich przez synchronizację. W chmurze synchronizacji nie ma, więc **klucze obce są** (z `ON DELETE RESTRICT`; usuwanie i tak jest oznaczeniem). Wyjątek: powiązania `targetType` + `targetId`.
11. **[chmura]** Pary unikalne (`action_participants`, `attendance`) mają indeks `UNIQUE` (w desktopie nie miały przez synchronizację).

### 2.2 Tabele techniczne i dostęp **[chmura]**

| Tabela | Najważniejsze pola | Uwagi |
|---|---|---|
| `settings` | orgName, profile, enabledModules (JSON), roleLabels (JSON), staleDays, sensitiveFieldsEnabled, retentionMonths, idleLogoutMinutes | jeden wiersz; pola domenowe jak w desktopie |
| `users` | email (unikalny), name, role (`admin`/`staff`/`readonly`), status (`invited`/`active`/`disabled`), kdfSalt, kdfIterations, authHash, authSalt, totpSecretEnc, totpEnabledAt, failedAttempts, lockedUntil, publicKey, privateKeyEnc, contactId, lastLoginAt | bez `deviceId`; hasła brak (rozdział 5.1 bezpieczeństwa) |
| `auth_sessions` | tokenHash, userId, createdAt, lastSeenAt, expiresAt, mfaPassed, userAgent (skrót) | sesja logowania; bez pełnego IP |
| `invitations` | tokenHash, email, role, invitedBy, expiresAt, usedAt | jednorazowy link |
| `org_keys` | version, createdAt, createdBy, retiredAt | metadane wersji klucza organizacji (sam klucz tylko w slotach) |
| `key_slots` | userId (null = slot odzyskiwania), keyVersion, wrappedKey, grantedBy, grantedAt | UNIQUE (userId, keyVersion) |
| `access_log` | userId, action (`login`, `login_failed`, `reveal_sensitive`, `export`, `download_attachment`, `grant_access`, `revoke_access`, `anonymize`, `backup`, …), targetType, targetId, at | bez danych osobowych; tylko dopisywanie |
| `change_log` | entity, entityId, op (`insert`/`update`/`delete`/`restore`/`anonymize`), changedFields (JSON), userId, at | dla `contact_identity` i `contact_sensitive` tylko nazwy pól |
| `erased_contacts` | contactId, erasedAt | lista do ponownego nałożenia po odtworzeniu kopii |
| `backups` | fileName, createdAt, createdBy, sizeBytes, checksum, restoreTestedAt, restoreTestResult | ZADANIE_04 |

### 2.3 Encje domenowe przeniesione z desktopu (stan prototypu po ZADANIU_05)

Kolumny jak w `..\NGO_CRM\src\main\db\schema.ts`, chyba że zaznaczono inaczej.

| Tabela | Zmiana względem desktopu |
|---|---|
| `contacts` | **[chmura]** zostaje: `kind`, `tags`, `anonymizedAt`. Pola `firstName`, `lastName`, `name`, `email`, `phone`, `address`, `city`, `notes` przechodzą do `contact_identity` |
| `contact_identity` | **nowa**: `contactId` (UNIQUE), pola tożsamości z desktopu |
| `contact_sensitive` | **nowa**: `contactId` (UNIQUE), `keyVersion`, `iv`, `ciphertext` (JSON pól wrażliwych zaszyfrowany w przeglądarce) |
| `contact_roles`, `relationships`, `consents` | bez zmian |
| `activities`, `activity_contacts` | bez zmian; `content` jako `text` |
| `topics` | bez zmian |
| `actions` | bez zmian |
| `sessions` → `action_sessions` | zmiana nazwy (kolizja z sesją logowania) |
| `action_participants`, `attendance` | UNIQUE na parach |
| `tasks`, `task_items` | bez zmian |
| `action_items`, `action_functions`, `action_function_people`, `budget_items`, `evaluations`, `prep_templates` | bez zmian (ZADANIE_05 chmury) |
| `file_links` | **[chmura]** zastąpione przez `attachments` |
| `attachments` | **nowa**: `targetType`, `targetId`, `purpose`, `keyVersion`, `metaEnc` (nazwa, typ, klucz pliku — zaszyfrowane), `sizeBytes`, `storageKey` (nazwa pliku w `STORAGE_DIR`, losowa) |
| `knowledge_notes` | bez zmian |
| `field_clocks`, `sync_peers`, `sync_conflicts`, `sync_pending`, `sync_state` | **nie przenosimy** (synchronizacja) |

### 2.4 Typy kolumn w MySQL/MariaDB
- UUID: `char(36)`. Znaczniki czasu: `datetime(3)` w UTC; warstwa repozytorium zamienia na ISO 8601. Same daty: `date`. Godziny: `char(5)` (`HH:mm`).
- Teksty krótkie `varchar(255)`, długie `text`/`mediumtext`. JSON: kolumna `json` (w MariaDB alias `longtext` z kontrolą poprawności).
- Kwoty w groszach: `int`. Flagi: `boolean`.
- Szyfrogramy: `mediumtext` w Base64 (prościej w JSON API niż `blob`).
- Kodowanie bazy: `utf8mb4`, porównania `utf8mb4_polish_ci` dla tożsamości (sortowanie po polsku).

### 2.5 Encje docelowe (z desktopowego szkicu, jeszcze niezbudowane)
Bez zmian względem `..\NGO_CRM\NGO_CRM_PROCESY_I_MODEL_DANYCH.md`, część 2.2: `Project`, `ProjectTemplate`, `Indicator`, `IndicatorAdjustment`, `ProjectParticipant`, `Deadline`, `Call`, `Application`, `PaidOrder`, `VolunteerAssignment`, `VolunteerAgreement`, `Membership`, `Fee`, `Body`, `Meeting`, `Resolution`, `Donation`, `Campaign`, `SocialProfile`, `Publication`, `MediaAsset`, `Resource`, `Reservation`, `Venue`, `Document`, `DocumentTemplate`, `ChecklistTemplate`, `CalendarEntry`, `CustomFieldDef`, `PortfolioEntry`, `Survey`/`SurveyResponse`.
**[chmura]** `SensitiveRecord` z desktopowego szkicu to tutaj `contact_sensitive`. `Document` i `MediaAsset` przechowują pliki przez `attachments`.

### 2.6 Kluczowe relacje

```
Contact ──1 ContactIdentity            (jawne dla serwera, wersja 1)
Contact ──1 ContactSensitive           (szyfrogram z przeglądarki)
Contact ──< ContactRole, Consent
Contact ──< Relationship >── Contact
Contact ──< Activity >── (Action | Project)

Action ──< ActionSession ──< Attendance >── Contact
Action ──< ActionParticipant >── Contact
Task, KnowledgeNote, Attachment → dowolny target

User ──< AuthSession
User ──< KeySlot >── OrgKey (wersja)
User ──< AccessLog, ChangeLog
```

### 2.7 Decyzje do podjęcia
1. Wsparcie uczestnika: `Activity` z formą i czasem (jak w desktopie) — bez zmian.
2. Pola własne: JSON w encji. **[chmura]** Pole własne może być oznaczone jako wrażliwe → trafia do szyfrogramu w `contact_sensitive`.
3. Zakres danych wrażliwych domyślnie: PESEL, orzeczenie (stopień, ważność), zdrowie, sytuacja rodzinna, notatki wrażliwe. Do potwierdzenia w wywiadach.
4. Format wymiany szablonów i profili: wspólny z desktopem (JSON).
5. **[chmura]** Treść osi aktywności przy anonimizacji (`NGO_CRM_CLOUD_BEZPIECZENSTWO.md`, rozdział 6).
6. **[chmura]** Czy notatka o osobie (`notes`) jest tożsamością (jawna dla serwera), czy daną wrażliwą. Propozycja: tożsamość; notatki wrażliwe to osobne pole w `contact_sensitive`.
