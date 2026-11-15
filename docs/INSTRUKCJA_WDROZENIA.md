Wersja programu: 0.1.0 (15.11.2026)

# Instrukcja wdrożenia: NGO CRM na Hostingerze

Ta instrukcja prowadzi krok po kroku od pustego konta w Hostingerze do działającego programu. Napisana jest dla osoby bez wiedzy technicznej. Zajmie ok. 1–2 godzin.

Powiązane dokumenty:
- [Lista kontrolna](LISTA_KONTROLNA.md) (co zrobić na start i co miesiąc, co robić przy incydencie)
- [Środki techniczne](SRODKI_TECHNICZNE.md) (opis zabezpieczeń do rejestru czynności i DPIA)

## Zanim zaczniesz

Najważniejsze zasady:
- **Organizacja sama prowadzi swój program.** Autor programu nie ma dostępu do waszych danych i nie może ich odzyskać.
- **Sekretów nie wpisuj do repozytorium ani do e-maili.** Wpisujesz je tylko w panelu Hostingera.
- **Nie ma tu rozstrzygnięć prawnych.** Umowy z hostingiem, rejestr czynności i ocena skutków (DPIA) wymagają konsultacji z prawnikiem lub inspektorem ochrony danych.

Co przygotować:
1. Konto w Hostingerze z planem, który pozwala na aplikację Node.js i bazę MySQL (np. plan Business; sprawdź w ofercie Hostingera).
2. Własną domenę (albo adres tymczasowy, który daje Hostinger).
3. Konto na GitHubie (darmowe) i dostęp do kodu programu: autor programu przekaże Wam go (dostęp do repozytorium albo paczkę z kodem). Sposób przekazywania kodu i aktualizacji nie jest jeszcze ostatecznie ustalony (program jest w wersji beta); jeśli kod dostaniecie inaczej niż przez repozytorium GitHuba, części 1, 3 i 8 trzeba będzie dostosować.
4. Drukarkę (albo kartkę i długopis) na klucz odzyskiwania.
5. Telefon z aplikacją do kodów 2FA (np. Google Authenticator, Microsoft Authenticator, FreeOTP).
6. Menedżer haseł albo bezpieczne miejsce na zapisanie kilku haseł (hasło do bazy, `APP_SECRET`).

## Część 1. Własna kopia programu na GitHubie (fork)

Fork to Wasza własna kopia programu na GitHubie. Hostinger będzie brał program z tej kopii. Dzięki temu nowe wersje instalujecie sami, jednym kliknięciem.

1. Zaloguj się na github.com.
2. Wejdź na stronę repozytorium programu.
3. Kliknij przycisk **Fork** (u góry po prawej).
4. Zostaw proponowaną nazwę i kliknij **Create fork**.
5. Zapisz adres swojej kopii, np. `twoja-organizacja/NGO_CRM_Cloud`. Będzie potrzebny w części 3.

## Część 2. Baza danych w Hostingerze

Baza to miejsce, w którym program trzyma dane.

1. Zaloguj się do panelu Hostingera (hPanel) i wybierz swoją stronę.
2. Znajdź sekcję **Bazy danych** (w niektórych wersjach panelu: **MySQL Databases**).
3. Utwórz nową bazę. Hostinger poprosi o trzy rzeczy: nazwę bazy, nazwę użytkownika i hasło.
4. Hasło ustaw z samych liter i cyfr, długie (min. 20 znaków). Znaki specjalne (`@ : / ? # % &`) psują adres połączenia.
5. Zapisz w menedżerze haseł: nazwę bazy, nazwę użytkownika i hasło. Hostinger zwykle dodaje do nich własny przedrostek (np. `u123456789_`). Zapisz pełne nazwy tak, jak pokazuje panel.

Z tych trzech wartości zbudujesz adres bazy (`DATABASE_URL`) w części 4.

## Część 3. Strona Node.js z GitHuba

1. W hPanel dodaj nową stronę typu **Node.js** (aplikacja Node.js). Nazwy przycisków mogą się różnić w zależności od wersji panelu.
2. Gdy panel poprosi o źródło, wybierz **GitHub** i połącz konto GitHub (jednorazowo, Hostinger poprosi o zgodę).
3. Wskaż swój fork (z części 1) i gałąź `main`.
4. Ustaw ustawienia budowania tak:
   - środowisko (framework): **Fastify** (jeśli panel go nie ma, wybierz „inna” aplikacja Node.js),
   - wersja Node.js: **22**,
   - polecenie budowania: `npm run build`,
   - plik startowy: `dist/server/index.js`.
5. Włącz automatyczne wdrażanie po zmianach w gałęzi `main` (auto-deploy). Dzięki temu nowa wersja zainstaluje się sama po aktualizacji forka (część 8).
6. Na razie nie uruchamiaj wdrożenia na siłę. Najpierw ustaw zmienne (część 4). Jeśli wdrożenie ruszy wcześniej, program pokaże ekran „Aplikacja czeka na konfigurację”. To normalne.

## Część 4. Zmienne środowiskowe

Zmienne to ustawienia programu wpisywane w panelu Hostingera (sekcja zmiennych środowiskowych tej aplikacji Node.js). Wzór wszystkich zmiennych jest w pliku `.env.example` w repozytorium.

Po każdej zmianie zmiennych Hostinger uruchamia aplikację od nowa. Ustaw wszystkie cztery wymagane zmienne, a dopiero potem czekaj na wynik.

| Zmienna | Co to jest | Co wpisać |
|---|---|---|
| `DATABASE_URL` | Adres połączenia z bazą (wymagana) | `mysql://UŻYTKOWNIK:HASŁO@127.0.0.1:3306/NAZWA_BAZY`, z danymi z części 2. Host to **127.0.0.1**, nie `localhost`. |
| `APP_SECRET` | Tajny klucz serwera (wymagana). Chroni zapisane sekrety 2FA. Minimum 32 znaki, losowy. | Losowa wartość (patrz niżej). **Zapisz ją w menedżerze haseł.** |
| `STORAGE_DIR` | Folder na załączniki i kopie zapasowe (wymagana) | Pełna ścieżka do folderu **poza folderem aplikacji** (patrz niżej). |
| `SETUP_TOKEN` | Jednorazowe hasło do kreatora pierwszego uruchomienia (wymagana tylko na starcie). Min. 32 znaki. | Losowa wartość (patrz niżej). **Usuń po założeniu konta administratora.** |
| `PORT` | Port serwera | **Nie ustawiaj.** Hostinger podaje go sam. |

Zmiennej `TEST_DATABASE_URL` z pliku `.env.example` **nigdy** nie ustawiaj na serwerze. Służy tylko do testów na komputerze programisty.

### Jak wygenerować `APP_SECRET` i `SETUP_TOKEN`

Najprostszy sposób: kreator pierwszego uruchomienia sam pokazuje wygenerowaną losową wartość, którą możesz wkleić jako `APP_SECRET` (wartość powstaje w Twojej przeglądarce i nigdzie nie jest zapisywana). Gdy brakuje zmiennej, program pokazuje ekran z instrukcją.

Drugi sposób: wygeneruj wartość menedżerem haseł (losowe hasło, 48 znaków, litery i cyfry). Dla `SETUP_TOKEN` wystarczy 40 znaków.

Trzeci sposób (dla osób, które mają zainstalowany Node.js na komputerze): w oknie poleceń wpisz

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

i skopiuj wynik. Dla `SETUP_TOKEN` zamień `48` na `32`.

Uwagi:
- **`APP_SECRET` zapisz w bezpiecznym miejscu.** Jeśli go zmienisz albo zgubisz, kody 2FA wszystkich osób przestaną działać i każda osoba ustawi 2FA od nowa.
- `SETUP_TOKEN` krótszy niż 32 znaki program odrzuci.

### Jak ustawić `STORAGE_DIR`

Załączniki i kopie zapasowe muszą leżeć **poza folderem aplikacji**. Hostinger przy każdej nowej wersji podmienia folder aplikacji i wszystko, co w nim leży, znika.

1. W hPanel otwórz **Menedżer plików** (File Manager) dla swojej domeny.
2. Znajdź folder swojej domeny (zwykle o ścieżce w stylu `/home/u123456789/domains/twoja-domena.pl/`).
3. Utwórz tam nowy folder o nazwie `storage`. **Nie** twórz go w `public_html` ani w folderze aplikacji (`hbuilds`, `nodejs`).
4. Zapisz pełną ścieżkę, np. `/home/u123456789/domains/twoja-domena.pl/storage`, i wpisz ją jako `STORAGE_DIR`.

Kreator sprawdzi, czy da się zapisać w tym folderze, i odmówi, jeśli folder leży w folderze aplikacji.

## Część 5. Pierwsze uruchomienie (kreator)

1. Poczekaj, aż Hostinger zbuduje aplikację (kilka minut; status zobaczysz w panelu).
2. Otwórz adres swojej domeny **zaczynający się od `https://`**. Powinien pojawić się ekran „Pierwsze uruchomienie”.
3. **Krok 1 z 5. Sprawdzenie serwera.** Wklej `SETUP_TOKEN` w polu „Token konfiguracji” i kliknij **Sprawdź**. Program sprawdzi trzy rzeczy: HTTPS, bazę danych i folder na pliki (`STORAGE_DIR`). Przy każdej powinno być „w porządku”. Jeśli coś jest nie tak, popraw zmienne w panelu i kliknij „Sprawdź ponownie”.
4. **Krok 2 z 5. Organizacja.** Wpisz nazwę organizacji i wybierz profil (np. „Koło gospodyń wiejskich”). Profil dobiera tylko moduły na start. Zmienisz go później.
5. **Krok 3 z 5. Administrator.** Wpisz imię i nazwisko, e-mail (to będzie login) i hasło. Hasło ma mieć co najmniej 12 znaków. Najlepiej kilka przypadkowych słów. **To hasło nie trafia na serwer i nikt go nie odzyska.** Zapisz je w menedżerze haseł.
6. **Krok 4 z 5. Klucz odzyskiwania.** Patrz niżej. To najważniejszy moment całej instalacji.
7. **Krok 5 z 5. Weryfikacja dwuetapowa (2FA).** Zeskanuj kod QR w aplikacji na telefonie, wpisz sześciocyfrowy kod i kliknij **Zakończ i załóż konto**. Bez 2FA nikt nie dostanie się do danych.
8. Na ekranie „Gotowe” zobaczysz listę rzeczy do zrobienia. Zrób je w kolejności z części 6.

### Klucz odzyskiwania

Klucz odzyskiwania to długi ciąg znaków. Program pokazuje go **tylko raz**.

Do czego służy: jeśli wszyscy administratorzy zapomną hasła, tylko klucz odzyskiwania pozwoli znów odczytać dane wrażliwe (PESEL, zdrowie, załączniki). Bez niego i bez hasła tych danych nie da się odzyskać. Autor programu też ich nie odzyska.

1. Kliknij **Drukuj** i wydrukuj klucz (albo przepisz go ręcznie na kartkę).
2. **Nie zapisuj go w komputerze, w telefonie, w chmurze ani w e-mailu.** Nie rób zdjęcia.
3. Wpisz 4 ostatnie znaki klucza w polu potwierdzenia. Program sprawdzi, czy go zapisałeś.
4. Zrób co najmniej dwa wydruki i schowaj je w dwóch różnych bezpiecznych miejscach (np. sejf organizacji i sejf drugiej osoby z zarządu). Szczegóły: [Lista kontrolna](LISTA_KONTROLNA.md).
5. Nie odświeżaj strony w tym kroku. Jeśli zaczniesz kreator od nowa, powstanie nowy klucz, a ten wydruk będzie nieważny.

## Część 6. Po założeniu konta

1. **Usuń zmienną `SETUP_TOKEN`** w panelu Hostingera. Kreator i tak już się nie uruchomi, ale token nie powinien leżeć w ustawieniach.
2. **Schowaj wydruk klucza odzyskiwania** (część 5).
3. Zaloguj się adresem e-mail, hasłem i kodem z aplikacji.
4. Na końcu ekranu „Gotowe” program mówi też: „Włącz automatyczne kopie zapasowe w panelu hostingu”. To dodatkowe zabezpieczenie, warto je włączyć. Program ma jednak własne kopie (patrz niżej) i ich nie zastępuje.

### Pierwsze pobranie kopii i „Sprawdź kopię”

Program sam robi kopię zapasową raz na dobę i trzyma 7 ostatnich dziennych oraz 4 tygodniowe. Pierwsza powstaje sama w ciągu godziny od startu. Kopia leży jednak na tym samym serwerze co program. Jeśli serwer się zepsuje, możecie ją stracić. Dlatego raz w tygodniu pobieraj kopię na swój komputer.

1. Wejdź w **Ustawienia**.
2. Znajdź kartę **Kopie zapasowe**. Jeśli nie ma jeszcze kopii, kliknij **Zrób kopię teraz** i poczekaj chwilę (lista odświeży się sama).
3. Przy kopii ze stanem „gotowa” kliknij **Pobierz**. Plik ma rozszerzenie `.ngb`.
4. Zapisz plik poza komputerem, na którym pracujecie (np. na dysku zewnętrznym albo w zaufanej chmurze organizacji). Plik jest zaszyfrowany, ale i tak traktuj go jak dane osobowe.
5. Kliknij **Sprawdź kopię**. Wskaż pobrany plik, wpisz swój e-mail i hasło. Program sprawdza plik na Twoim komputerze (plik i hasło nie są wysyłane na serwer).
6. Poprawny wynik wygląda tak: „Kopia z (data): (liczba osób, działań, dokumentów). Da się ją odtworzyć.”

Dobrze wiedzieć:
- Po zmianie hasła starszą kopię otwiera **hasło z dnia kopii**, nie nowe. Po każdej zmianie hasła administratora program sam robi nową kopię.
- Jeśli kopia nie powstaje, w Ustawieniach pojawi się czerwony komunikat (zwykle brakuje `STORAGE_DIR`).
- Po tygodniu bez pobrania kopii program pokazuje przypomnienie „Pobierz kopię na swój komputer”.

### Stan bezpieczeństwa

W **Ustawieniach** (pierwsza karta, widoczna dla administratora) jest **Stan bezpieczeństwa**: lista spraw z kolorami. Zielone: dobrze. Żółte: zajmij się tym w wolnej chwili. Czerwone: zajmij się tym teraz. Szare: nie da się ocenić. Przy sprawach do zrobienia jest opis, co zrobić. Czerwone sprawy widać też na ekranie „Dziś”. Zajrzyj tam po wdrożeniu i potem co miesiąc ([Lista kontrolna](LISTA_KONTROLNA.md)).

### Zaproszenie kolejnych osób

1. W **Ustawieniach**, w karcie „Użytkownicy”, kliknij **Zaproś osobę**.
2. Wpisz dane osoby i kliknij **Utwórz zaproszenie**.
3. Przekaż jednorazowy link tej osobie (osobiście albo komunikatorem). Link działa raz i wygasa. Nie zobaczysz go ponownie.
4. Osoba ustawia swoje hasło i 2FA. Dostęp do danych wrażliwych nadajesz jej osobno, tylko jeśli naprawdę go potrzebuje.

## Część 7. Okres przechowywania danych osób

W **Ustawieniach** jest karta „Okres przechowywania danych osób”. Wpisz, po ilu miesiącach bez aktywności program ma przypominać o danej osobie (podpowiedź: 24; puste pole = wyłączone). Program niczego nie usuwa sam: o każdej osobie decydujesz Ty („Usuń na stałe…” albo „Zostaw jeszcze na rok”). Jak długo wolno przechowywać dane, ustalcie z prawnikiem lub inspektorem ochrony danych.

## Część 8. Aktualizacja do nowej wersji

Program raz na dobę pyta publiczny serwis GitHub, czy jest nowa wersja (nie wysyła przy tym żadnych danych o Waszej organizacji). Informację zobaczysz w Ustawieniach, w karcie „Stan bezpieczeństwa”. Poprawki bezpieczeństwa oznaczone są na czerwono. Sprawdzanie można wyłączyć przyciskiem „Wyłącz sprawdzanie nowej wersji” w tej samej karcie. Wtedy sami pilnujecie, czy jest nowa wersja.

Jak zainstalować nową wersję:
1. **Zrób kopię i pobierz ją** (część 6), a potem kliknij „Sprawdź kopię”. Dzięki temu możesz wrócić do poprzedniego stanu.
2. Wejdź na swój fork na GitHubie (część 1).
3. Kliknij **Sync fork**, a potem **Update branch**.
4. Poczekaj kilka minut. Hostinger sam zbuduje i zainstaluje nową wersję (jeśli włączyłeś auto-deploy w części 3). Możesz sprawdzić postęp w panelu Hostingera.
5. Zaloguj się i sprawdź w „Stanie bezpieczeństwa”, że widać nową wersję (także w stopce Ustawień: „Wersja programu …”).

Zmiany w bazie danych program wprowadza sam przy starcie. Nie musisz nic robić.

## Część 9. Odtworzenie po awarii

Użyj tego, gdy serwer się zepsuł, zniknęła baza albo przenosicie program na nowy hosting.

### Co jest potrzebne

| Potrzebne | Po co |
|---|---|
| **Plik kopii** (`.ngb`) | To są Wasze dane. Najlepiej najnowszy pobrany na komputer. |
| **E-mail i hasło administratora z dnia kopii** | Tym otwiera się kopię. Po zmianie hasła starsze kopie otwiera stare hasło. |
| **Nowa, pusta baza** | Odtworzenie działa tylko na bazie bez żadnych kont. |
| **Zmienne środowiskowe** (część 4) | `DATABASE_URL`, `APP_SECRET`, `STORAGE_DIR`, `SETUP_TOKEN`. |
| **`APP_SECRET` z dnia kopii** (jeśli go zapisaliście) | Z nim kody 2FA działają po odtworzeniu bez zmian. |
| **Klucz odzyskiwania** (wydruk) | **Nie jest potrzebny do samego odtworzenia.** Zostaje jednak waszym ratunkiem, gdyby wszyscy zapomnieli hasła. Miejcie go pod ręką. |

### Kroki

1. Jeśli to nowy hosting albo nowa strona: wykonaj części 1–4 (fork, baza, strona Node.js, zmienne). Zawsze zacznij od **pustej** bazy. Jeśli stara baza ma już konta, utwórz nową bazę albo wyczyść starą w panelu Hostingera.
2. Ustaw `SETUP_TOKEN` (część 4). Pozostałe zmienne ustaw tak jak na początku. Jeśli masz zapisany stary `APP_SECRET`, wpisz go.
3. Otwórz adres programu przez `https://`. Wklej token w kreatorze i kliknij **Sprawdź**.
4. Po udanym sprawdzeniu kliknij **Mam kopię zapasową: odtwórz z kopii**.
5. Wskaż plik kopii (`.ngb`), wpisz e-mail i hasło administratora z dnia kopii, kliknij **Odtwórz**.
6. Program sprawdza plik, wysyła go na serwer kawałkami (zobaczysz procenty) i odtwarza dane. **Nie zamykaj strony.** Może to potrwać kilka minut.
7. Przeczytaj wynik: „Odtworzono: (liczba osób, …)”. Zwróć uwagę na ostrzeżenia:
   - o anonimizacjach zrobionych po kopii (program nakłada je ponownie, jeśli ma stary folder `STORAGE_DIR`; jeśli go nie ma, **powtórz te usunięcia ręcznie**),
   - o dokumentach bez pliku w dniu kopii,
   - o zresetowanym 2FA (gdy `APP_SECRET` jest inny niż w dniu kopii; wtedy każdy ustawi 2FA od nowa przy logowaniu).
8. Kliknij **Przejdź do logowania**. Wszyscy logują się tak jak przed awarią, tymi samymi hasłami.
9. Usuń zmienną `SETUP_TOKEN` z panelu.
10. Zrób nową kopię, pobierz ją i sprawdź (część 6, „Pierwsze pobranie kopii i Sprawdź kopię”).

Jeśli kopia pochodzi z nowszej wersji programu niż ta na serwerze, program poprosi o aktualizację: „Najpierw zaktualizuj program”. Zrób wtedy Sync fork (część 8) i odtwórz kopię jeszcze raz.

Jeśli program pisze, że hasło nie pasuje do kopii: wpisz hasło, które administrator miał w dniu zrobienia tej kopii.

## Gdy coś nie działa

| Objaw | Co sprawdzić |
|---|---|
| Strona pokazuje „Aplikacja czeka na konfigurację” | Brakuje zmiennej `DATABASE_URL` albo `APP_SECRET`, albo `APP_SECRET` ma mniej niż 32 znaki. Ekran wymienia, które zmienne ustawić. |
| Błąd połączenia z bazą (np. „access denied”) | W `DATABASE_URL` host musi być **127.0.0.1**, a nie `localhost` ani adres typu `srvNNN.hstgr.io`. Sprawdź nazwę bazy, użytkownika i hasło (z przedrostkiem Hostingera). Znaki specjalne w haśle zepsują adres, więc ustaw hasło z samych liter i cyfr. Gdy to nie pomaga, utwórz nową bazę i nowego użytkownika. |
| Kreator odmawia przy `STORAGE_DIR` | Folder musi być poza folderem aplikacji i musi istnieć możliwość zapisu. Sprawdź ścieżkę w Menedżerze plików. |
| Kreator mówi, że token jest nieprawidłowy lub za krótki | `SETUP_TOKEN` musi mieć co najmniej 32 znaki i być wklejony bez spacji. |
| Kreator „nie jest dostępny” | Konto administratora już istnieje (kreator działa tylko na pustej bazie). Zaloguj się. |
| Kopie nie powstają, w Ustawieniach czerwony komunikat | Zwykle brakuje `STORAGE_DIR`. Ustaw go (część 4). Hostinger uruchomi program od nowa. |
| Przy odtwarzaniu kopii błąd albo przerwanie | Hostinger przerywa żądania trwające dłużej niż **120 sekund**. Przy bardzo dużej bazie odtwarzanie może się nie zmieścić w tym czasie. Spróbuj ponownie. Jeśli to się powtarza, poproś o pomoc osobę techniczną. |
| Nie masz dostępu do wiersza poleceń (SSH) | To normalne: dla aplikacji Node.js Hostinger nie daje takiego dostępu. Wszystko, co trzeba, robisz przez panel Hostingera, GitHub i sam program (kreator). |
| Po zmianie zmiennej program się „zawiesza” | Każda zmiana zmiennej uruchamia budowanie od nowa. Poczekaj kilka minut i odśwież stronę. |
| Zapomniane hasło administratora | Jeśli jest drugi administrator, może zresetować konto (karta „Użytkownicy” → **Resetuj**). Po resecie dostęp do danych wrażliwych trzeba nadać ponownie. Jeśli nikt nie ma dostępu do danych wrażliwych: ekran **Odzyskaj dostęp** i klucz odzyskiwania z wydruku. |
| Konto zablokowane po błędnych próbach logowania | Po 5 błędnych próbach konto blokuje się na 15 minut. Poczekaj i spróbuj ponownie. |
| Program nagle wylogował | Sesja kończy się po 30 minutach bezczynności i po 12 godzinach od logowania. Zaloguj się ponownie. |

Czego nie robić: nie wysyłaj nikomu haseł, klucza odzyskiwania, `APP_SECRET` ani pliku kopii (poza zaufaną osobą z organizacji). Jeśli potrzebujecie pomocy technicznej, użyjcie przycisku **Kopia do pomocy…** w karcie kopii. Pobierzesz plik ze spseudonimizowanymi danymi (bez imion, nazwisk, e-maili, danych wrażliwych i załączników). Plik nie jest zaszyfrowany i nie jest anonimowy, więc wysyłaj go tylko komuś, z kim macie umowę powierzenia (skonsultuj z prawnikiem lub inspektorem ochrony danych).
