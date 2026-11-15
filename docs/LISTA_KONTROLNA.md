Wersja programu: 0.1.0 (15.11.2026)

# Lista kontrolna bezpieczeństwa

Jedna strona do odhaczania. Wydrukuj ją albo skopiuj. Szczegóły kroków: [Instrukcja wdrożenia](INSTRUKCJA_WDROZENIA.md). Opis zabezpieczeń dla rejestru i DPIA: [Środki techniczne](SRODKI_TECHNICZNE.md).

Tam, gdzie dotykamy prawa (RODO, umowy powierzenia, ocena skutków, zgłoszenia naruszeń), ta lista niczego nie rozstrzyga. **Skonsultuj z prawnikiem lub inspektorem ochrony danych.**

## Na start (jednorazowo)

Program i serwer:
- [ ] Program działa pod adresem z `https://`.
- [ ] Zmienne `DATABASE_URL`, `APP_SECRET`, `STORAGE_DIR` ustawione; `STORAGE_DIR` jest poza folderem aplikacji.
- [ ] `SETUP_TOKEN` usunięty z panelu Hostingera po założeniu administratora.
- [ ] `APP_SECRET` zapisany w menedżerze haseł (bez niego po awarii 2FA trzeba ustawić od nowa).
- [ ] Administrator ma 2FA. Każda osoba z kontem ma własne konto (bez wspólnych haseł) i 2FA.
- [ ] Dostęp do danych wrażliwych mają tylko osoby, które go potrzebują.

Klucz odzyskiwania:
- [ ] Klucz wydrukowany, wpisano 4 ostatnie znaki w kreatorze.
- [ ] Są co najmniej **dwa wydruki w dwóch różnych miejscach** (patrz niżej).
- [ ] Klucza nie ma w komputerze, w telefonie, w chmurze ani w e-mailu.

Kopie:
- [ ] Pierwsza kopia powstała, pobrana na komputer, zapisana poza serwerem.
- [ ] Kliknięto „Sprawdź kopię” i wynik brzmi „Da się ją odtworzyć”.
- [ ] Włączono też kopie w panelu Hostingera (dodatkowe zabezpieczenie).

Dokumenty prawne (skonsultuj z prawnikiem lub inspektorem ochrony danych):
- [ ] Umowa powierzenia przetwarzania danych z hostingiem (Hostinger) zawarta lub potwierdzona.
- [ ] Umowa powierzenia z każdym informatykiem albo inną osobą z zewnątrz, która ma dostęp do serwera lub danych.
- [ ] Wpis w rejestrze czynności przetwarzania (opis zabezpieczeń do wklejenia: [Środki techniczne](SRODKI_TECHNICZNE.md)).
- [ ] Ocena skutków dla ochrony danych (DPIA), jeśli prawnik lub inspektor uzna, że jest potrzebna (dane o zdrowiu to szczególna kategoria).
- [ ] Ustalono okres przechowywania danych i wpisano go w programie (Ustawienia → „Okres przechowywania danych osób”).
- [ ] Wiadomo, kto w organizacji odpowiada za zgłoszenie naruszenia (patrz „Incydent”).

## Co miesiąc

- [ ] Ustawienia → **Stan bezpieczeństwa**: nic nie jest czerwone ani żółte (a jeśli jest, zrobiono, co program podpowiada).
- [ ] Zainstalowano nową wersję, jeśli jest (Sync fork → Update branch; wcześniej kopia). Poprawki bezpieczeństwa od razu.
- [ ] Kopia pobrana na komputer (co tydzień; program przypomina po 7 dniach).
- [ ] **Sprawdź kopię** kliknięte przynajmniej raz w miesiącu.
- [ ] Lista użytkowników przejrzana: odeszłe osoby mają wyłączone konto (karta „Użytkownicy” → **Wyłącz**). Po odebraniu dostępu do danych wrażliwych rozważ „Zmień klucz organizacji”.
- [ ] Lista „Osoby po okresie przechowywania” przejrzana: osoby zanonimizowane („Usuń na stałe…”) albo odłożone („Zostaw jeszcze na rok”).
- [ ] Dziennik dostępu przejrzany pod kątem czegoś niezwykłego (Ustawienia → „Dziennik dostępu”).
- [ ] Komputery osób pracujących w programie: aktualny system i przeglądarka, program antywirusowy, blokada ekranu.

## Kto za co odpowiada

| Robi program | Robi organizacja |
|---|---|
| Szyfruje dane wrażliwe i załączniki w przeglądarce | Wybiera hosting i podpisuje umowę powierzenia z hostingiem i z informatykiem |
| Wymusza 2FA, pilnuje uprawnień, prowadzi dziennik dostępu | Nadaje i odbiera dostęp, pilnuje haseł i 2FA ludzi |
| Robi kopie, pozwala je pobrać i sprawdzić | Pobiera kopie, trzyma je poza serwerem, przechowuje klucz odzyskiwania |
| Pokazuje „Stan bezpieczeństwa” i ostrzeżenia | Instaluje aktualizacje |
| Dostarcza dokumentację i wzory (ten dokument, opis środków) | Prowadzi rejestr czynności, DPIA i zgłasza naruszenia |
| Nie ma dostępu do waszych danych (autor programu nie jest operatorem) | Dba o bezpieczeństwo komputerów użytkowników |

Poza zasięgiem programu (odpowiada organizacja): zainfekowany komputer użytkownika, nieuczciwy administrator organizacji, brak aktualizacji, przejęcie serwera z podmianą kodu programu.

## Klucz odzyskiwania: kto go trzyma

- [ ] Osoba 1 (imię): __________________ miejsce: __________________
- [ ] Osoba 2 (imię): __________________ miejsce: __________________
- [ ] To dwa różne miejsca (np. sejf organizacji i dom osoby z zarządu). Nie biuro, w którym stoi serwer ani komputer z programem.
- [ ] Po „Zmień klucz organizacji” powstaje **nowy** klucz. Stare wydruki zniszczono, nowe rozdano.
- [ ] Osoby wiedzą, do czego klucz służy: odzyskanie dostępu do danych wrażliwych, gdy wszyscy zapomną hasła.

## Incydent: podejrzenie wycieku lub włamania

Przykłady: zgubiony lub skradziony komputer z zalogowanym programem, wysłanie danych do złej osoby, podejrzane logowanie, osoba, która odeszła, a miała dostęp, nieznane wpisy w dzienniku dostępu.

1. **Nie panikuj i nie kasuj niczego.** Zapisz, co się stało, kiedy i kto to zauważył.
2. Ogranicz szkody w programie (administrator):
   1. Ustawienia → „Użytkownicy”: **Wyłącz** konto osoby, której dotyczy problem (zostanie wylogowana i straci dostęp do danych wrażliwych). Gdy ktoś mógł przejąć konto, użyj **Resetuj**.
   2. Poproś osobę o zmianę hasła i użycie opcji **Wyloguj wszędzie**.
   3. Gdy ktoś z dostępem do danych wrażliwych mógł je zapamiętać lub skopiować: Ustawienia → **Zmień klucz organizacji**.
   4. Gdy ktoś mógł zdobyć dostęp do panelu Hostingera lub bazy: zmień hasło do Hostingera, hasło bazy (i `DATABASE_URL` w panelu). Zmiana `APP_SECRET` unieważnia kody 2FA wszystkich użytkowników (każdy ustawia je od nowa), więc rób ją tylko w ostateczności.
3. Zabezpiecz dowody: w „Dzienniku dostępu” ustaw filtry i kliknij **Eksport CSV**. Zrób nową kopię i pobierz ją.
4. Sprawdź, jakich danych to dotyczy (zwykłe, wrażliwe, czyje) i czy były zaszyfrowane (dane wrażliwe i załączniki szyfruje przeglądarka, imię, nazwisko i kontakt nie).
5. **Powiadom osobę odpowiedzialną w organizacji** (zarząd, inspektor ochrony danych, jeśli macie) w ciągu godzin, nie dni.
6. **Oceń z prawnikiem lub inspektorem ochrony danych, czy trzeba zgłosić naruszenie.** Wskazówka do sprawdzenia: RODO zakłada zgłoszenie do Prezesa UODO bez zbędnej zwłoki, w miarę możliwości **w ciągu 72 godzin** od stwierdzenia naruszenia (o ile naruszenie może powodować ryzyko dla osób). Termin liczy się od chwili, gdy dowiedziałeś się o naruszeniu. Przy wysokim ryzyku trzeba też powiadomić osoby, których dane dotyczą.
7. Gdy dane przetwarza dla was podmiot zewnętrzny (hosting, informatyk): sprawdź w umowie powierzenia, w jakim terminie ma was powiadomić o naruszeniu.
8. Zapisz incydent w rejestrze naruszeń organizacji (także wtedy, gdy zgłoszenie okazało się zbędne).
9. Po incydencie: ustal przyczynę, popraw proces (hasła, 2FA, dostępy), zaktualizuj tę listę.

Utrata danych też jest naruszeniem. Gdy zepsuł się serwer: [odtworzenie po awarii](INSTRUKCJA_WDROZENIA.md).

Data przeglądu listy: __________  Podpis: __________
