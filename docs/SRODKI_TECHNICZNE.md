Wersja programu: 0.1.0 (15.11.2026)

# Środki techniczne i organizacyjne zabezpieczeń (NGO CRM, wersja chmurowa)

> **Uwaga: to opis techniczny, nie opinia prawna.** Opisuje, co robi program. Nie rozstrzyga, czy wasze przetwarzanie jest zgodne z RODO, ani czy wystarczą te środki. Rejestr czynności, ocenę skutków (DPIA), umowy powierzenia i podstawy prawne **skonsultuj z prawnikiem lub inspektorem ochrony danych.**

Dokument jest do wklejenia (w całości albo we fragmentach) do rejestru czynności przetwarzania i do DPIA. Powiązane: [Instrukcja wdrożenia](INSTRUKCJA_WDROZENIA.md), [Lista kontrolna](LISTA_KONTROLNA.md).

## 1. Jak działa program (w skrócie)

- Program działa w przeglądarce. Dane leżą w bazie MySQL/MariaDB i w folderze plików na hostingu organizacji. Każda organizacja sama wdraża i utrzymuje swoją instancję.
- **Autor programu nie jest operatorem, nie ma dostępu do danych i nie ma połączeń do serwerów autora.** Jedyne połączenie wychodzące to sprawdzanie nowej wersji w publicznym serwisie GitHub (raz na dobę, bez danych organizacji i bez identyfikatorów; można je wyłączyć w Ustawieniach).
- Program nie zawiera telemetrii ani zewnętrznych skryptów (nie ładuje niczego z cudzych serwerów).
- Dostawca hostingu przetwarza dane w imieniu organizacji (umowa powierzenia: do zawarcia przez organizację).

## 2. Tabela środków

| Środek | Co robi | Gdzie w programie |
|---|---|---|
| Szyfrowanie danych wrażliwych w przeglądarce | PESEL, orzeczenia, zdrowie i notatki wrażliwe osoby są szyfrowane (AES-GCM, klucz organizacji) w przeglądarce, zanim trafią na serwer. Serwer przechowuje tylko szyfrogram. Szyfrogramu nie da się przenieść do innej osoby. | Karta osoby: dane wrażliwe (zamaskowane, odsłaniane kliknięciem, po „Odblokuj”). Moduł wyłączony domyślnie, włącza go administrator. |
| Szyfrowanie załączników w przeglądarce | Każdy plik ma własny losowy klucz (AES-GCM) i jest szyfrowany w przeglądarce przed wysłaniem. Nazwa i typ pliku też są zaszyfrowane. Serwer zna rozmiar oraz to, kto i kiedy dodał plik. Limit pliku: 20 MB. | Dokumenty przy osobie. |
| Model kluczy: serwer nie ma klucza ani hasła | Hasło jest przeliczane w przeglądarce (PBKDF2-SHA256, 600 000 iteracji). Z niego powstają dwa klucze: jeden służy do logowania (serwer zapisuje tylko jego skrót scrypt), drugi odszyfrowuje klucz prywatny użytkownika i **nigdy nie opuszcza przeglądarki**. Z klucza do logowania nie da się odtworzyć drugiego. Klucz organizacji jest zapisany tylko w „slotach”: zaszyfrowany kluczem publicznym każdej uprawnionej osoby. Serwer nie jest w stanie odczytać danych wrażliwych. | Logowanie. Ustawienia → „Użytkownicy” (nadawanie i odbieranie dostępu do danych wrażliwych jako osobne uprawnienie). |
| Zmiana klucza organizacji | Po odebraniu dostępu można utworzyć nowy klucz organizacji. Dane wrażliwe i załączniki są wtedy przeszyfrowywane w przeglądarce administratora. Powstaje nowy klucz odzyskiwania. | Ustawienia → „Zmiana klucza organizacji”. |
| Klucz odzyskiwania | Losowy klucz pokazany raz przy zakładaniu organizacji, do wydruku. Pozwala odzyskać dostęp do danych wrażliwych, gdy wszyscy zapomną hasła. Na serwerze jest tylko slot odzyskiwania, nie sam klucz. | Kreator pierwszego uruchomienia. Ekran „Odzyskaj dostęp”. |
| Blokada danych wrażliwych | Klucze nie są zapisywane w `localStorage` ani `sessionStorage`. Znikają z pamięci przeglądarki po odświeżeniu strony i po 15 minutach bezczynności. | Przycisk „Odblokuj”. |
| Weryfikacja dwuetapowa (2FA) | Obowiązkowa dla wszystkich kont (kody TOTP z aplikacji w telefonie). Bez 2FA sesja nie ma dostępu do niczego poza ustawieniem 2FA. Sekret TOTP jest zapisany na serwerze w postaci zaszyfrowanej kluczem z `APP_SECRET`. | Logowanie, kreator. Ustawienia → Stan bezpieczeństwa („Konta bez 2FA”). |
| Konta i uprawnienia | Konto dla każdej osoby, bez wspólnych haseł. Brak publicznej rejestracji: tylko zaproszenia jednorazowym linkiem od administratora. Trzy role: administrator, pracownik, tylko odczyt. Role są egzekwowane przez serwer przy każdym wywołaniu, a automatyczny test sprawdza wszystkie metody pod kątem logowania i roli. | Ustawienia → „Użytkownicy”. |
| Hasła | Minimum 12 znaków, odrzucanie najsłabszych haseł (sprawdza przeglądarka, bo serwer hasła nie widzi). | Kreator, zaproszenie, „Zmień hasło”. |
| Ochrona logowania | 5 nieudanych prób na konto blokuje konto na 15 minut. Limit 20 nieudanych prób z jednego adresu IP na 15 minut (licznik tylko w pamięci serwera, adres IP nie jest zapisywany). Odpowiedź serwera nie zdradza, czy dane konto istnieje. | Logowanie. |
| Sesje | Losowy token w ciasteczku `httpOnly`, `Secure`, `SameSite=Strict`; w bazie jest tylko skrót tokenu. Sesja po 2FA trwa maks. 12 godzin, wylogowanie po 30 minutach bezczynności. Jest też „Wyloguj wszędzie”. Wyłączenie konta kończy sesje tej osoby. | Menu konta. |
| HTTPS i nagłówki | Bez HTTPS program nie obsługuje żądań (poza adresem lokalnym do prób). Nagłówki: HSTS, `Content-Security-Policy` bez `unsafe-inline` i `unsafe-eval` i bez zewnętrznych źródeł, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`. | Wszystkie odpowiedzi serwera. Ustawienia → Stan bezpieczeństwa („Bezpieczne połączenie (HTTPS)”). |
| Ochrona przed fałszowaniem żądań (CSRF) | `SameSite=Strict`, sprawdzanie nagłówka `Origin` i własny nagłówek przy każdym żądaniu zmieniającym dane. | Automatycznie. |
| Ochrona zapytań | Zapytania do bazy tylko przez bibliotekę ORM (bez sklejania SQL). Walidacja każdego wejścia schematem. | Automatycznie. |
| Pliki | Kontrola rozmiaru. Pobieranie zawsze jako załącznik (`Content-Disposition: attachment`), bez zapamiętywania w przeglądarce (`no-store`). Pliki w folderze poza folderem aplikacji i poza publicznym. | Dokumenty. |
| Dziennik dostępu | Zapisuje: kto, co i kiedy odsłonił dane wrażliwe, pobrał dokument, wyeksportował dane, zmienił dostęp lub klucze, zrobił, pobrał, sprawdził lub odtworzył kopię, pobrał kopię do pomocy, usunął na stałe dane osoby. Tylko identyfikatory i nazwy zdarzeń, **bez treści danych**. Filtry i eksport CSV dla administratora. | Ustawienia → „Dziennik dostępu”. |
| Dziennik zmian (techniczny) | Każdy zapis danych zapisuje historię zmian. Dla tożsamości i danych wrażliwych tylko **nazwy zmienionych pól**, bez wartości. Rekordy mają numer wersji: zapis na starej wersji jest odrzucany („Ktoś zmienił ten rekord w międzyczasie”). | Automatycznie. |
| Kopie zapasowe | Program robi kopię sam raz na dobę (pierwsza w ciągu godziny od startu), trzyma 7 ostatnich dziennych i 4 tygodniowe. Kopia obejmuje wszystkie tabele i załączniki (załączniki i dane wrażliwe są w niej nadal zaszyfrowane w przeglądarce, więc podwójnie). Treść kopii jest szyfrowana (AES-GCM). Kopię otwiera e-mail i hasło administratora, a klucz kopii jest zawinięty kluczem publicznym każdego aktywnego administratora. Pliki leżą w `STORAGE_DIR`, poza folderem aplikacji. Pobranie wymaga sesji z 2FA i roli administratora. Przypomnienie o pobraniu po 7 dniach. | Ustawienia → „Kopie zapasowe”. |
| Sprawdzanie kopii | „Sprawdź kopię”: przeglądarka odszyfrowuje plik i sprawdza spójność (sumy, liczby rekordów i plików). Plik i hasło nie są wysyłane na serwer. Wynik (bez treści danych) zapisuje się na liście kopii. Panel ostrzega, gdy kopii nie pobrano ponad 7 dni lub nie sprawdzano ponad 30 dni, a gdy kopii nie ma ponad 2 dni, jest czerwony. | Karta „Kopie zapasowe” → „Sprawdź kopię”. Stan bezpieczeństwa. |
| Odtwarzanie z kopii | Na pustej bazie, w kreatorze pierwszego uruchomienia, za jednorazowym tokenem. Po odtworzeniu nakładane są ponownie wcześniejsze usunięcia na stałe (anonimizacje), o ile istnieje plik z listą identyfikatorów w `STORAGE_DIR`. | Kreator: „Mam kopię zapasową: odtwórz z kopii”. |
| Okresy przechowywania | Administrator ustawia, po ilu miesiącach bez aktywności program przypomina o osobie. Program **niczego nie usuwa sam**: lista osób do przejrzenia, przy każdej „Usuń na stałe…” albo „Zostaw jeszcze na rok”. Nie przypomina o osobach z aktywną rolą członka, pracownika, darczyńcy ani o osobach powiązanych z kimś aktywnym. | Ustawienia → „Okres przechowywania danych osób”. Stan bezpieczeństwa. |
| Usunięcie osoby i anonimizacja | „Usuń na stałe” jest nieodwracalne: usuwa tożsamość, dane wrażliwe, załączniki i wolny tekst osoby (zostają dane statystyczne bez możliwości identyfikacji). Nie ma Kosza dla osób. Dowodem jest wpis w dzienniku dostępu (kto, kiedy, identyfikator osoby). Lista usuniętych identyfikatorów (bez danych osobowych) jest też zapisywana w pliku w `STORAGE_DIR`. | Karta osoby, administrator: „Usuń na stałe…”. |
| Eksport danych osoby | Komplet danych o osobie (prawo dostępu z art. 15 RODO) jako plik. Zapis w dzienniku dostępu. Eksport list do CSV z ostrzeżeniem i bez danych wrażliwych. | Karta osoby, eksport list. |
| Kopia do pomocy technicznej | Plik **spseudonimizowany** (nie anonimowy): identyfikatory losowe, imiona zastąpione etykietami typu „Osoba 17”, bez e-maili, telefonów, adresów, danych wrażliwych, załączników, haseł, kluczy, dziennika dostępu i treści wpisów, zadań i notatek. Plik nie jest zaszyfrowany. Z samych dat i powiązań da się czasem domyślić, kogo dotyczą dane. Pobranie jest zapisywane w dzienniku dostępu. | Karta „Kopie zapasowe” → „Kopia do pomocy…”. |
| Brak danych osobowych w logach serwera | Dziennik pracy serwera zawiera tylko metodę, wzorzec trasy, kod wyniku i czas. Bez adresu IP, nagłówków, treści żądań, nazw i e-maili. | Automatycznie (panel hostingu: logi aplikacji). |
| Brak telemetrii | Brak analityki, zewnętrznych czcionek i skryptów (polityka CSP na to nie pozwala). Jedyne połączenie wychodzące: sprawdzanie wersji w GitHub (wyłączalne). | Ustawienia → Stan bezpieczeństwa („Wyłącz sprawdzanie nowej wersji”). |
| Panel „Stan bezpieczeństwa” | Jedna lista spraw z kolorami: wersja programu, HTTPS, folder `STORAGE_DIR`, ostatnia kopia, pobranie i sprawdzenie kopii, konta bez 2FA, kto ma dostęp do danych wrażliwych i czy jest klucz odzyskiwania, niedokończona zmiana klucza, osoby po okresie przechowywania. Pilne sprawy widać też na ekranie „Dziś”. | Ustawienia (administrator). |
| Aktualizacje | Nowa wersja pokazywana w panelu, poprawki bezpieczeństwa wyróżnione. Instalacja przez GitHub („Sync fork”), po stronie organizacji. | Ustawienia → Stan bezpieczeństwa. |
| Zależności | Niewielka liczba bibliotek, plik blokujący wersje (lockfile), `npm audit` przed wydaniem. | Repozytorium. |

## 3. Ograniczenia (mówimy wprost)

Te punkty warto przenieść do DPIA jako ryzyka rezydualne i dopisać własne środki:

1. **Przejęcie serwera z podmianą kodu programu.** Kto przejmie serwer i podmieni kod, może przechwycić hasło przy następnym logowaniu. Model kluczy przed tym nie chroni. Chronią: dobre hasło do Hostingera i GitHuba z 2FA, aktualizacje, przegląd dziennika.
2. **Wyciek bazy i słabe hasło.** Wyciek bazy przy słabym haśle użytkownika pozwala na atak słownikowy poza serwerem. Utrudniają to PBKDF2, scrypt i wymagania co do hasła, ale nie wykluczają w pełni.
3. **Tożsamość jest jawna dla serwera.** Imię, nazwisko, e-mail, telefon i adres nie są szyfrowane w przeglądarce (potrzebne do wyszukiwania i wykrywania duplikatów). Szyfrowane są tylko dane wrażliwe i załączniki. Wyciek bazy ujawni tożsamości. W bazie tożsamość leży w osobnej tabeli, a reszta danych odwołuje się tylko do identyfikatorów.
4. **Wyszukiwanie po danych wrażliwych** działa tylko w przeglądarce, po odblokowaniu.
5. **Zainfekowany komputer użytkownika, nieuczciwy administrator organizacji, brak aktualizacji** są poza zasięgiem programu. To odpowiedzialność organizacji.
6. **Kopie zapasowe a hasła.** Kopię otwiera hasło administratora z dnia kopii. Starsze kopie po zmianie hasła otwiera stare hasło. Jeśli wszyscy administratorzy stracą hasła z dnia kopii, kopii nie da się otworzyć (klucz odzyskiwania służy do dostępu do danych wrażliwych, nie do otwierania pliku kopii).
7. **`APP_SECRET`.** Jego utrata po awarii oznacza, że kody 2FA trzeba ustawić od nowa. Do czasu ponownego ustawienia 2FA samo hasło wystarcza do wejścia na ekran konfiguracji 2FA (odtwarzanie jest dlatego chronione jednorazowym tokenem kreatora).
8. **Kopia do pomocy jest tylko spseudonimizowana**, nie anonimowa, i nie jest zaszyfrowana. Wysyłać ją można wyłącznie podmiotowi, z którym jest umowa powierzenia.
9. **Usunięcia na stałe a stare kopie.** Kopia zrobiona przed usunięciem osoby zawiera jej dane. Po odtworzeniu usunięcie jest nakładane ponownie tylko wtedy, gdy zachował się plik z listą identyfikatorów w `STORAGE_DIR` (przy odtwarzaniu na nowym serwerze bez starego folderu usunięcia trzeba powtórzyć ręcznie). Stare pliki kopii pobrane na komputery użytkowników zawierają dane, dopóki nie zostaną usunięte.
10. **Dostępność.** Utrata danych też jest naruszeniem. Kopia na serwerze jest tylko pierwszą linią. Pobieranie kopii poza serwer i jej sprawdzanie zależy od organizacji.
11. **Środowisko hostingowe.** Bezpieczeństwo systemu operacyjnego, serwera WWW, certyfikatu HTTPS i bazy zapewnia dostawca hostingu (zakres do sprawdzenia w jego umowie i dokumentacji).

## 4. Środki po stronie organizacji (do uzupełnienia)

Program nie zastąpi tych środków. Dopisz je do rejestru i DPIA (szczegóły: [Lista kontrolna](LISTA_KONTROLNA.md)):
- umowa powierzenia z hostingiem i z osobami zewnętrznymi (skonsultuj z prawnikiem),
- przechowywanie klucza odzyskiwania w co najmniej dwóch miejscach, poza komputerem,
- przekazywanie i odbieranie dostępów, miesięczny przegląd listy użytkowników,
- aktualizacje programu i comiesięczny przegląd „Stanu bezpieczeństwa”,
- bezpieczeństwo komputerów i telefonów użytkowników,
- procedura incydentu i zgłaszania naruszeń (termin 72 godzin do UODO: do sprawdzenia z prawnikiem lub inspektorem ochrony danych),
- okresy przechowywania danych dla każdej kategorii osób (ustalenie z prawnikiem lub inspektorem ochrony danych).
