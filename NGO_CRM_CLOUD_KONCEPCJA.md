---
typ: koncepcja
projekt: NGO_CRM Cloud
wersja: 0.1
status: koncepcja (stack do potwierdzenia w ZADANIU_01, krok 0)
aktualizacja: 2026-11-14
---

# NGO_CRM Cloud — koncepcja v0.1

Wersja chmurowa NGO_CRM. Domena, moduły i model polski są wspólne z wersją desktopową (`..\NGO_CRM\NGO_CRM_KONCEPCJA.md`, v0.4) i zostały tu przeniesione, żeby repo było samodzielne. Inne są: architektura (rozdział 4), etapy (5), odrzucone opcje (8) i bezpieczeństwo (osobny dokument `NGO_CRM_CLOUD_BEZPIECZENSTWO.md`).

## 0. Dlaczego druga wersja

Wersja desktopowa (local-first) zostaje. Wersja chmurowa jest dla organizacji, które:
- pracują w kilka osób jednocześnie, także z różnych miejsc,
- wolą przeglądarkę niż instalowanie programu na każdym komputerze,
- mają (albo mogą wynająć) osobę, która raz postawi aplikację na hostingu i będzie instalować aktualizacje.

Zmienia to decyzję z 10.11.2026 o odrzuceniu self-hostingu: hosting zarządzany (Node.js + MySQL, ok. 400–500 zł rocznie z domeną) aktualizuje system, serwer WWW, SSL i bazę, więc po stronie organizacji zostaje wdrożenie, aktualizacje aplikacji i dostęp ludzi. Ścieżka sprawdzona na [iV_CRM] (ten sam hosting).

## 1. Problem i cel

Małe i średnie polskie NGO (stowarzyszenia, fundacje, KGW) nie mają dedykowanego, lekkiego narzędzia do prowadzenia swojej działalności. Pracują na Excelu i papierze. Salesforce (nawet ze zniżką dla NGO) i inne ciężkie systemy to kombajny używane do jednego, dwóch celów, wymagające wdrożeniowca.

**Cel:** lekki, modułowy CRM w przeglądarce, dopasowany do typu organizacji, który:
- organizacja stawia na własnym hostingu bez informatyka na etacie (kreator pierwszego uruchomienia, instrukcja krok po kroku),
- nie wymaga utrzymania po stronie autora (MOC nie jest operatorem),
- trzyma dane w organizacji, a autor nie ma do nich dostępu (brak roli podmiotu przetwarzającego w RODO — do potwierdzenia u prawnika),
- przy włamaniu na serwer daje jak najmniej: najgroźniejsze dane szyfruje przeglądarka, serwer nie ma klucza,
- obsługuje wiele osób jednocześnie, każdą z własnym kontem i 2FA,
- jest open source.

## 2. Polska specyfika (dlaczego nie model amerykański)

- W USA rdzeniem CRM dla NGO jest darczyńca. W Polsce rdzeniem jest **działanie, projekt i uczestnik**.
- Finansowanie głównie projektowe: EFS+ (FERS, programy regionalne), PFRON, NIW (FIO, PROO), konkursy ofert JST, małe granty (art. 19a), fundacje korporacyjne, Fundusze EOG.
- 1,5% podatku idzie przez konto i księgowość, nie przez CRM. Darowizny i zbiórki to u większości niewielki odsetek: CRM ma je traktować jako **bazę relacji**, nie jako księgowość.
- Rozliczalność wsparcia: rekrutacja, kwalifikowalność, formy wsparcia, godziny, obecności, wskaźniki, trwałość.
- Dane wrażliwe uczestników (PESEL, status, orzeczenie): RODO to największa bolączka. **W wersji chmurowej to najważniejszy wymóg techniczny.**
- Relacje głównie z instytucjami (JST, PUP, OPS, PCPR, szkoły, firmy).
- Kadra projektowa i rotacyjna, wolontariusze, w stowarzyszeniach członkowie i składki. **Rotacja = częste nadawanie i odbieranie dostępu.**
- Doświadczenie organizacji potrzebne do ofert i wniosków (portfolio).
- Małe zespoły, zwykle bez informatyka, praca na laptopach.

Poza zakresem: kluby sportowe, koła wędkarskie, OHP.

## 3. Typy organizacji (profile)

| Profil | Charakter | Potrzeby |
|---|---|---|
| KGW | tylko działania wolontaryjne | osoby, działania, wolontariat, członkinie, proste dokumenty |
| Mała — darczyńcy | darczyńcy w małym zakresie | relacje z darczyńcami, podziękowania, działania |
| Mała — zbiórki | zbiórki publiczne i celowe | baza zbiórek i osób, nie księgowość |
| Średnia — projektowa | projekty grantowe | rozbudowany moduł projektów i uczestników |

Profil wybiera się w kreatorze pierwszego uruchomienia. Włącza on pasujące moduły, które można potem dowolnie włączać i wyłączać.

Dla KGW wersja chmurowa jest zwykle za ciężka (hosting, aktualizacje). Dla nich zostaje desktop. Wersja chmurowa celuje głównie w profile „średnia — projektowa” i większe „małe”.

## 4. Architektura (PROPOZYCJA 2026-11-14, do potwierdzenia)

### 4.1 Model: aplikacja webowa na hostingu organizacji
- Jedna instancja = jedna organizacja. Bez wielu organizacji w jednej bazie (brak ryzyka wycieku między organizacjami, prostszy kod).
- Organizacja wynajmuje hosting zarządzany z Node.js i MySQL/MariaDB (wzór: Hostinger Business, Node 22, wdrożenie z repozytorium GitHub).
- Serwer jest jedynym źródłem prawdy. Bez synchronizacji, bez pracy offline (na start).
- Bez telemetrii i bez połączeń do serwerów MOC. Sprawdzenie nowej wersji: zapytanie do publicznych wydań na GitHubie, wyłączalne w ustawieniach.

### 4.2 Trzy strefy danych
| Strefa | Co | Gdzie widać tekst jawny |
|---|---|---|
| Zwykłe dane | działania, zadania, obecności, statystyki, tematy, ustawienia | serwer i przeglądarka |
| Tożsamość | imię, nazwisko, e-mail, telefon, adres, notatka o osobie | serwer i przeglądarka (wersja 1); później szyfrowana w przeglądarce |
| Dane wrażliwe i załączniki | PESEL, orzeczenie, zdrowie, notatki wrażliwe, wszystkie pliki | **tylko przeglądarka uprawnionej osoby** |

Zwykłe dane znają osobę tylko przez UUID. Baza bez tabeli tożsamości pokazuje numery i statystyki, nie ludzi (pseudonimizacja, `NGO_CRM_CLOUD_BEZPIECZENSTWO.md`, rozdział 6).

### 4.3 Wiele osób
- Konto dla każdej osoby, bez wspólnych haseł. Zaproszenie przez jednorazowy link od administratora (bez publicznej rejestracji).
- Role programu: administrator, pracownik, tylko odczyt. Dostęp do danych wrażliwych nadawany osobno (slot klucza).
- Jednoczesna edycja: blokada optymistyczna (`version`). Kto zapisuje starszą wersję, dostaje komunikat i widzi aktualne dane. Bez scalania pole po polu.
- Odświeżanie: lista i karta pobierają dane przy wejściu i po zapisie; powiadomień na żywo na start nie ma.

### 4.4 RODO wbudowane
- Minimalizacja domyślnie: pola wrażliwe wyłączone, włączane świadomie w ustawieniach.
- Dane wrażliwe i załączniki szyfrowane w przeglądarce, pola zamaskowane na ekranie i odsłaniane kliknięciem (wpis w dzienniku dostępu).
- Dziennik dostępu po stronie serwera: kto, co i kiedy otworzył, odsłonił lub wyeksportował.
- Okresy przechowywania z przypomnieniem o usunięciu lub anonimizacji.
- Anonimizacja osoby (usuwa tożsamość i dane wrażliwe, zostawia statystykę) i eksport danych osoby (prawo dostępu).
- Szablony: klauzula informacyjna, zgoda, wpis do rejestru czynności przetwarzania, opis środków technicznych do DPIA.
- Klucz odzyskiwania do wydruku (utrata wszystkich haseł z dostępem i klucza odzyskiwania = utrata danych wrażliwych).

### 4.5 Kopie i aktualizacje bez autora
- Kopia z poziomu aplikacji, niezależna od kopii hostingu: plik w `STORAGE_DIR` do pobrania, rotacja, przypomnienie po X dniach bez kopii.
- Przycisk „sprawdź odtworzenie” i panel „Stan bezpieczeństwa” (wersja, ostatnia kopia, kto nie ma 2FA).
- Eksport do Excela/CSV w każdym widoku (brak uwięzienia danych), z ostrzeżeniem i minimalnym zestawem kolumn.
- Aktualizacje: wydania na GitHubie; organizacja aktualizuje swoje repozytorium (fork) i hosting wdraża je sam. Migracje bazy przy starcie.

### 4.6 Personalizacja bez programowania
- Profil startowy i włączane moduły.
- Własne nazwy (uczestnik / podopieczny / członkini / beneficjent).
- Własne pola.
- Szablony dokumentów z logo organizacji.
- Konfiguracja eksportowana do pliku, więc gotowe profile można udostępniać jak szablony (ten sam format co w desktopie, jeśli się da).

### 4.7 Stack (PROPOZYCJA, do potwierdzenia w ZADANIU_01, krok 0)
- **Klient:** Vite + React + TypeScript (strict), SPA. Tailwind + shadcn/ui. WebCrypto do szyfrowania.
- **Serwer:** Node 22 + Fastify. Jeden proces: API pod `/api`, zbudowany klient jako pliki statyczne.
- **Baza:** MySQL/MariaDB, Drizzle ORM (`mysql2`), migracje z `drizzle-kit`.
- zod, Vitest. Minimum zależności.

**Dlaczego nie Next.js jak iV_CRM** (iV_CRM działa na tym samym hostingu na Next.js):
1. **Przeniesienie z desktopu.** Interfejs desktopu to React + Vite rozmawiający z jednym kanałem `rpc` przez kontrakt zod. W SPA zamieniamy tylko transport (IPC → `POST /api/rpc`); widoki, `src/shared` i większość logiki przechodzą prawie bez zmian.
2. **Szyfrowanie w przeglądarce.** Klucze żyją tylko w pamięci karty. Renderowanie po stronie serwera i tak nie zobaczy danych wrażliwych, więc nic nie daje.
3. **Ścisła CSP** bez nonce'ów i wyjątków: statyczny pakiet, zero skryptów inline.
4. **Mniejsza powierzchnia ataku:** bez Server Actions i React Server Components (w 2025 r. była w nich krytyczna podatność zdalnego wykonania kodu).

**Ryzyko:** Hostinger jest sprawdzony u nas tylko z Next.js. Dlatego ZADANIE_01 zaczyna się od próbnego wdrożenia (Fastify + SPA + MySQL + migracja) na Hostingerze. Jeśli się nie uda, wracamy do Next.js w wersji iV_CRM (koszt: interfejs trzeba przepisać mocniej).

### 4.8 Wspólny kod z desktopem
- **Osobne repo, kopia zamiast wspólnego pakietu.** Wspólny pakiet wymagałby monorepo albo publikacji; przy dwóch małych projektach to więcej pracy niż zysku. Desktop zostaje źródłem logiki domenowej, a zmiany domenowe przenosimy ręcznie (lista w karcie projektu).
- Do przeniesienia: `src/shared` (typy domeny, kontrakt, kalendarz, ICS, CSV, budżet, ewaluacja, szablony przygotowania, święta, „zamarłe” rekordy), widoki z `src/renderer`, logika usług z `src/main/services` (z przejściem na zapytania asynchroniczne: `mysql2` w przeciwieństwie do `better-sqlite3` jest asynchroniczny).
- Nie przenosimy: synchronizacji (`src/main/sync`), pliku klucza `.ngokey`, folderu materiałów na dysku, drukowania przez Electron (zastępuje je druk z przeglądarki).
- Wspólny format eksportu (CSV, profile, szablony), żeby organizacja mogła przejść z desktopu do chmury. Import bazy desktopowej: później.

### 4.9 Kolejność prac (PROPOZYCJA)
- **ZADANIE_01: fundament.** Próbne wdrożenie na Hostingerze, szkielet, MariaDB i migracje, logowanie z kluczem wyprowadzanym w przeglądarce, 2FA, sesje, role i kontrakt RPC z testem uprawnień, nagłówki bezpieczeństwa, kreator pierwszego uruchomienia (administrator, klucz organizacji, klucz odzyskiwania), zaproszenia.
- **ZADANIE_02: rdzeń z desktopu.** Osoby i instytucje (z podziałem na tożsamość), role, powiązania, zgody, oś aktywności, działania z zajęciami i obecnością, tematy, zadania, „Dziś”, kalendarz z ICS, kosz. Wygląd jak w desktopie.
- **ZADANIE_03: dane wrażliwe.** Szyfrowanie pól wrażliwych i załączników w przeglądarce, nadawanie i odbieranie dostępu, maskowanie, dziennik dostępu, anonimizacja, eksport danych osoby.
- **ZADANIE_04: utrzymanie.** Kopie i test odtworzenia, panel „Stan bezpieczeństwa”, powiadomienie o nowej wersji, instrukcja wdrożenia dla organizacji i lista kontrolna bezpieczeństwa.
- **ZADANIE_05: działania v2, materiały i wiedza** (odpowiedniki desktopowych ZADAŃ 03 i 04).
- Dalej: projekty jako kontener, wolontariat, kolejne moduły, klucze dostępu (passkeys).
- Przed pilotażem: przegląd bezpieczeństwa całości (lista z `NGO_CRM_CLOUD_BEZPIECZENSTWO.md`).

## 5. Etapy

1. **Etap 1:** fundament, rdzeń, dane wrażliwe, kopie (ZADANIA 01–04). Pierwsza organizacja testowa na danych fikcyjnych.
2. **Etap 2:** pozostałe moduły, import z Excela/CSV, pilotaż z 1–2 organizacjami na prawdziwych danych (po konsultacji prawnej).
3. **Etap 3:** szyfrowanie w przeglądarce także tożsamości, klucze dostępu, wersja uproszczona dla wolontariuszy lub mobilna, ewentualny test penetracyjny.

## 6. Model udostępniania
- Program open source. Za darmo albo za jednorazową opłatą (decyzja po konsultacji Cyber Resilience Act, `NGO_CRM_CLOUD_BEZPIECZENSTWO.md`, rozdział 8).
- Ewentualny dochód: szkolenia, pomoc we wdrożeniu (bez dostępu do danych produkcyjnych albo z umową powierzenia), konfiguracja profili. Bez abonamentu i SLA.

## 7. Moduły i funkcjonalności (jak w desktopie, wersja robocza 2026-11-10)

Wyjściowa lista MOC: szkolenia, baza uczestników i współpracy, kontakty, projekty, media, baza wiedzy, zadania, kalendarz. Szczegóły każdego modułu do rozpisania po personach i wywiadach (wspólnych dla obu wersji: `..\NGO_CRM\NGO_CRM_PERSONY_I_WYWIADY.md`).

### 7.1 Układ: trzy warstwy

| Warstwa | Moduły | Włączanie |
|---|---|---|
| **Fundament** | osoby i instytucje, oś aktywności, zadania, kalendarz, dokumenty i szablony, import/eksport, ustawienia i RODO, **użytkownicy i dostęp** | zawsze |
| **Moduły działania** | działania i wydarzenia (w tym szkolenia), wolontariat, organizacja i członkowie, projekty z naborami, uczestnicy i wsparcie, darczyńcy i zbiórki, media i kampanie, zasoby i rezerwacje | wg profilu, dowolnie |
| **Moduły wiedzy i wyników** | baza wiedzy, portfolio doświadczeń, raporty i pulpit | wg profilu, dowolnie |

### 7.2 Fundament

- **Osoby i instytucje: jedna baza z rolami** (uczestnik, wolontariusz, darczyńca, partner, członek, pracownik, trener). Jedna osoba może mieć kilka ról.
  - **Karta uczestnika** jako rozszerzenie osoby: dane wrażliwe w osobnej sekcji, zaszyfrowane w przeglądarce, zamaskowane, odsłaniane kliknięciem.
  - Instytucje: JST, PUP, OPS, PCPR, szkoły, firmy, inne NGO, media; osoby kontaktowe, relacje, porozumienia.
- **Oś aktywności** (wzór CiviCRM): każdy kontakt, wsparcie, notatka, udział w działaniu to jeden wpis z datą, osobą i typem.
- **Zadania:** lista, kanban, checklisty z szablonów, przypomnienia (w aplikacji; e-mail później, jeśli hosting pozwoli).
- **Kalendarz:** terminy ze wszystkich modułów, eksport do pliku ICS.
- **Dokumenty i szablony:** listy obecności, deklaracje, zaświadczenia, umowy wolontariackie, klauzule RODO, z logo organizacji. Druk z przeglądarki.
- **Import z Excela/CSV** i eksport w każdym widoku.
- **Ustawienia i RODO:** profile, moduły, własne nazwy i pola, zgody (w tym na wizerunek), okresy przechowywania, dziennik dostępu.
- **Użytkownicy i dostęp:** zaproszenia, role, 2FA, dostęp do danych wrażliwych, sesje, „wyloguj wszędzie”, panel „Stan bezpieczeństwa”.
- Wyszukiwarka globalna (po tożsamości po stronie serwera; po danych wrażliwych nie da się), archiwum i kosz.

### 7.3 Moduły działania

**Działania i wydarzenia** (z typem „szkolenie”)
- Typy: szkolenie, warsztat, wydarzenie, spotkanie, zbiórka, inne.
- Działanie może należeć do projektu albo nie.
- Pole **„w ramach czego”**: projekt / działalność statutowa nieodpłatna / statutowa odpłatna / gospodarcza (CRM oznacza, nie księguje).
- Typ „szkolenie” (wzór iV_CRM): temat z katalogu, trener, sala, uczestnicy, lista obecności, ewaluacja, zaświadczenia, materiały.
- Etapy, osoba odpowiedzialna, przygotowanie z szablonami, budżet (planowane i wydane), ewaluacja — jak w desktopowym ZADANIU_03.
- Dla odpłatnych: lekka ścieżka zapytanie → oferta → zlecenie → realizacja → „do zafakturowania”. Faktura poza CRM.

**Projekty: kontener, nie rozliczalnik**
- Rama (nazwa, źródło, okres, partnerzy, osoby, dokumenty, notatki), działania, opcjonalnie wskaźniki liczone z danych, terminy, uczestnicy z kryteriami, budżet orientacyjny.
- Działalność statutowa jako projekt; szablony projektów; nabory i wnioski jako przedsionek.
- Poza zakresem: rozliczanie budżetu, wnioski o płatność, kwalifikowalność wydatków.

**Uczestnicy i wsparcie**
- Formy wsparcia, godziny, obecności, notatki, ścieżka uczestnika; jedna osoba w wielu projektach. Flagi „brak wsparcia od X dni”.

**Wolontariat**
- Kto, przy czym, ile godzin; porozumienia, ubezpieczenie, zaświadczenia; dostępność; checklisty wprowadzenia.

**Organizacja i członkowie**
- Organy, statut, KRS, status OPP. Bez wbudowanego kalendarza obowiązków ustawowych. Członkowie, składki (ewidencja), zebrania, protokoły, uchwały.

**Darczyńcy i zbiórki: baza relacji, nie księgowość**
- Kto, kiedy, na co, czy podziękowanie wysłane; zbiórki z przypomnieniem o zgłoszeniu i sprawozdaniu.

**Media i kampanie:** rejestr i plan publikacji, bez integracji z API platform. Zgody na wizerunek przy zdjęciach.

**Zasoby i rezerwacje:** sprzęt, sale; kto wypożyczył, kiedy oddaje.

### 7.4 Moduły wiedzy i wyników
- **Baza wiedzy:** procedury, wzory, wnioski po projektach; notatki z tagami. W chmurze: załączniki zamiast folderu na dysku (zaszyfrowane jak wszystkie pliki).
- **Portfolio doświadczeń** generowane z działań i projektów.
- **Raporty i pulpit:** ekran „Dziś”, „zamarłe” rekordy, wskaźniki, podsumowania roczne, ankiety, wykrywanie duplikatów (po tożsamości).

### 7.5 Warstwa AI (opcjonalna, później)
- Na kluczu API organizacji; bez AI program działa w pełni.
- **Dane wrażliwe nigdy nie trafiają do AI** (serwer ich nie ma). Tożsamość domyślnie wyłączona z AI.
- Zasady stałe jak w desktopie: AI niczego nie dopowiada, liczby liczy program, wynik zawsze do zatwierdzenia przez człowieka.

### 7.6 Moduły wg profilu (wstępnie)

| Moduł | KGW | Mała (darczyńcy / zbiórki) | Średnia (projekty) |
|---|---|---|---|
| Fundament | ✔ | ✔ | ✔ |
| Działania i wydarzenia | ✔ | ✔ | ✔ |
| Wolontariat | ✔ | ✔ | ✔ |
| Organizacja i członkowie | ✔ | opcjonalnie | opcjonalnie |
| Zasoby i rezerwacje | ✔ | opcjonalnie | opcjonalnie |
| Darczyńcy i zbiórki | opcjonalnie | ✔ | opcjonalnie |
| Media i kampanie | opcjonalnie | ✔ | ✔ |
| Projekty (z naborami) | lekko (rok statutowy) | ✔ | ✔ |
| Uczestnicy i wsparcie | – | opcjonalnie | ✔ |
| Baza wiedzy | opcjonalnie | ✔ | ✔ |
| Portfolio doświadczeń | – | ✔ | ✔ |
| Raporty i pulpit | ✔ | ✔ | ✔ |

## 8. Odrzucone opcje (z uzasadnieniem)
- **SaaS hostowany przez MOC:** stała administracja i bezpieczeństwo po stronie autora, autor staje się podmiotem przetwarzającym. Bez zmian względem desktopu.
- **Wiele organizacji w jednej instancji:** ryzyko wycieku między organizacjami, a i tak nie ma operatora, który by ją utrzymywał.
- **Backend w chmurze zakładany przez organizację (Supabase, Firebase, PocketBase Cloud):** kolejne konto i panel do administrowania, dane poza UE lub trudne do kontroli; hosting z Node i MySQL jest prostszy i tańszy.
- **VPS z własnym systemem:** organizacja musiałaby aktualizować system i serwer WWW. Hosting zarządzany robi to sam.
- **Next.js:** możliwy plan B (rozdział 4.7).
- **Partner-operator** (np. centrum wspierania NGO hostuje dla wielu organizacji): możliwe w przyszłości, wymaga umów powierzenia. Nie teraz.

## 9. Przegląd rynku

Pełny przegląd (2026-11-10): `..\NGO_CRM\NGO_CRM_KONCEPCJA.md`, rozdział 9. Wnioski ważne dla wersji chmurowej:
1. Nie ma gotowej bazy do dostosowania; w Polsce rynek pokrywa tylko fundraising na podopiecznych. Nisza projektowa, wolontariat i KGW są wolne.
2. Polskie systemy chmurowe (crm-ngo.pl, ngoCRM) to SaaS za 250–1 350 zł netto miesięcznie. Self-hosting za ok. 400–500 zł rocznie to mocny argument.
3. Open source z serwerem (CiviCRM, Dolibarr, EspoCRM) wymaga wdrożeniowca i jest ciężki. Przewaga: lekkość, polski model i bezpieczeństwo domyślnie (kreator, 2FA, szyfrowanie w przeglądarce).
4. Wzorce do zapożyczenia jak w desktopie: CiviCRM (model danych), Dolibarr i Beacon (moduły), EspoCRM (pola bez kodu), Plinth i Charitylog (jedna osoba w wielu programach, obecność zasila wskaźniki), easyVerein (inwentarz, protokoły), JVerein (import CSV, blokada zamkniętych okresów). Do tego Bitwarden (hasło nie opuszcza przeglądarki, klucze w slotach).

## 10. Otwarte kwestie
- Potwierdzenie stacku po próbnym wdrożeniu (ZADANIE_01, krok 0).
- Potwierdzenie u prawnika: brak roli podmiotu przetwarzającego; Cyber Resilience Act przy jednorazowej opłacie.
- Licencja open source (AGPL chroni przed zamknięciem kodu przez kogoś, kto hostuje dla innych; MIT/Apache prostsze).
- Jak organizacja aktualizuje aplikację: fork na GitHubie i „Sync fork” czy paczka do wgrania? (wpływa na instrukcję wdrożenia).
- Procedura przy utracie klucza danych wrażliwych (kto w organizacji trzyma klucz odzyskiwania).
- Nazwa produktu (wspólna z desktopem).
