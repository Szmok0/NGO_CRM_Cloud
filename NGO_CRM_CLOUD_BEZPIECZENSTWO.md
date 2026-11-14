---
typ: wymagania
projekt: NGO_CRM Cloud
wersja: 0.2
status: wymagania obowiązujące; model kluczy (rozdział 5) do przeglądu przed ZADANIEM_01
aktualizacja: 2026-11-14
---

# NGO_CRM Cloud — wymagania bezpieczeństwa

Historia: szkic z rozmowy 2026-11-13 (wcześniej `..\NGO_CRM\NGO_CRM_CHMURA_BEZPIECZENSTWO.md`), przeniesiony do repo wersji chmurowej 2026-11-14 i uzupełniony o model kluczy (rozdział 5). Ten dokument obowiązuje w każdym zadaniu.

## 1. Założenia
- Osobne repo, osobna struktura i zabezpieczenia. Wersja desktopowa (local-first) zostaje.
- Open source. Za darmo albo za jednorazową opłatą (patrz rozdział 8, CRA).
- **MOC nie jest operatorem.** Każda organizacja sama wdraża i utrzymuje swoją instancję.
- Docelowe środowisko: **hosting zarządzany z Node.js i MySQL/MariaDB** (np. Hostinger z domeną, ok. 400–500 zł rocznie), czyli ta sama ścieżka co [iV_CRM]. System, serwer WWW, SSL i bazę aktualizuje dostawca.
- Bez wersji mobilnej na start. Praca w przeglądarce na komputerze.

## 2. Zasady projektowe
1. **Włamanie na serwer ma dawać jak najmniej.** Najgroźniejsze dane szyfruje przeglądarka, serwer nie ma klucza.
2. **Bezpiecznie domyślnie.** Nie da się uruchomić programu bez HTTPS, z domyślnym hasłem, bez 2FA administratora.
3. **Utrata danych to też naruszenie.** Kopie, test odtworzenia i klucz odzyskiwania są częścią bezpieczeństwa, nie dodatkiem.

## 3. Podział odpowiedzialności
| Odpowiada program (MOC jako autor) | Odpowiada organizacja (administrator danych) |
|---|---|
| Brak znanych słabości w kodzie, aktualizacje bezpieczeństwa | Wybór hostingu, umowa powierzenia z hostingiem i z informatykiem |
| Szyfrowanie pól wrażliwych i załączników | Instalowanie aktualizacji |
| 2FA, uprawnienia, dziennik dostępu | Nadawanie i odbieranie dostępu, hasła, 2FA ludzi |
| Mechanizm kopii i testu odtworzenia | Robienie kopii, przechowywanie klucza odzyskiwania |
| Ostrzeżenia i panel „Stan bezpieczeństwa” | Bezpieczeństwo komputerów użytkowników |
| Dokumentacja i wzory | Rejestr czynności, DPIA, zgłaszanie naruszeń (72 h do UODO) |

MOC nigdy nie ma dostępu do danych produkcyjnych. Gdyby kiedyś doszło do płatnego wdrożenia z dostępem do danych, potrzebna jest umowa powierzenia.

Poza zasięgiem programu (odpowiedzialność organizacji): zainfekowany komputer użytkownika, nieuczciwy administrator organizacji, brak aktualizacji, przejęcie serwera z podmianą kodu aplikacji.

## 4. Wymagania — wersja 1 (obowiązkowo)

### Dane
- Tożsamość (imię, nazwisko, kontakt) i dane wrażliwe w osobnych tabelach. Działania, obecności i statystyki odwołują się tylko do UUID.
- **Szyfrowanie po stronie przeglądarki** (WebCrypto, AES-GCM): PESEL, orzeczenie, zdrowie, notatki wrażliwe i **wszystkie załączniki**.
- Klucz danych wrażliwych organizacji dostępny dla każdego uprawnionego użytkownika przez jego slot (rozdział 5). Klucz odzyskiwania do wydruku.
- Pola wrażliwe domyślnie wyłączone. Okresy przechowywania z przypomnieniem.
- Anonimizacja osoby: usuwa dane identyfikujące, zostawia statystykę. Czyści też historię zmian. Lista usuniętych ID (bez danych osobowych) nakładana po odtworzeniu kopii. Anonimizacja jako zabezpieczenie: rozdział 6.
- Eksport danych osoby (prawo dostępu).

### Dostęp
- Konto dla każdej osoby, bez wspólnych haseł. Bez publicznej rejestracji: tylko zaproszenia od administratora.
- 2FA obowiązkowe dla wszystkich (TOTP w wersji 1; klucze dostępu później).
- Ograniczenie prób logowania i blokada po serii błędów. Sesje w ciasteczkach `httpOnly`, wylogowanie po bezczynności, „wyloguj wszędzie”.
- Role egzekwowane przez serwer i automatyczne testy uprawnień dla każdej metody API.
- Dziennik dostępu po stronie serwera: kto, co i kiedy otworzył, odsłonił lub wyeksportował. Eksport dziennika na potrzeby incydentu.
- Pola wrażliwe zamaskowane na ekranie, odsłaniane kliknięciem.

### Aplikacja
- Zapytania tylko przez ORM, bez sklejania SQL. Walidacja zod każdego wejścia.
- Ochrona CSRF, ścisła CSP, nagłówki bezpieczeństwa (HSTS itd.). Bez HTTPS aplikacja odmawia pracy.
- Kontrola przesyłanych plików: rozmiar, liczba, brak wykonywania, pobieranie zawsze jako załącznik (`Content-Disposition: attachment`). Typ pliku zna tylko przeglądarka (metadane zaszyfrowane).
- Brak danych osobowych w logach, same ID.
- Eksporty CSV/Excel/PDF z ostrzeżeniem, domyślnie minimalny zestaw kolumn.
- Minimum zależności, lockfile, `npm audit` w CI, przegląd bezpieczeństwa przed każdym wydaniem.

### Wdrożenie
- Kreator pierwszego uruchomienia: sprawdzenie HTTPS, bazy i sekretów, administrator z wymuszonym 2FA, klucz organizacji, wydruk klucza odzyskiwania.
- Sekrety tylko w zmiennych środowiskowych, nigdy w repozytorium. Jeśli sekretu brakuje, kreator pokazuje wygenerowaną losową wartość do wklejenia w panelu hostingu i odmawia dalszej pracy.
- Własna kopia z poziomu aplikacji, niezależna od kopii hostingu. Rotacja i przycisk „sprawdź odtworzenie”.
- Panel „Stan bezpieczeństwa” dla administratora: wersja aktualna lub nie, ostatnia kopia i test odtworzenia, kto nie ma 2FA, kto ma dostęp do danych wrażliwych.
- Powiadomienie o nowej wersji i prosta aktualizacja.

### Dokumenty dla organizacji
- Instrukcja wdrożenia krok po kroku i lista kontrolna bezpieczeństwa.
- Opis środków technicznych do rejestru czynności i DPIA.
- Przypomnienie o umowach powierzenia, procedura incydentu, podział odpowiedzialności z rozdziału 3.

## 5. Model kluczy (PROPOZYCJA 2026-11-14)

Wzór: Bitwarden (hasło nie opuszcza przeglądarki) i 1Password (klucz organizacji w slotach użytkowników). Wszystko na WebCrypto w przeglądarce i `node:crypto` na serwerze, bez bibliotek kryptograficznych.

### 5.1 Hasło nie trafia do serwera
1. Przed logowaniem przeglądarka pobiera dla e-maila sól i parametry. Dla nieistniejącego e-maila serwer zwraca sól wyliczoną z `HMAC(APP_SECRET, e-mail)`, więc odpowiedź nie zdradza, kto ma konto.
2. Przeglądarka liczy `master = PBKDF2-SHA256(hasło, sól, 600 000 iteracji)`. Parametry zapisane przy użytkowniku, żeby dało się je później podnieść.
3. Z `master` przez HKDF powstają dwa niezależne klucze:
   - `authKey` — wysyłany do serwera zamiast hasła. Serwer przechowuje `scrypt(authKey, sól serwera)` (jak hasło w iV_CRM),
   - `wrapKey` — **nigdy nie opuszcza przeglądarki**, odszyfrowuje klucz prywatny użytkownika.
4. Z `authKey` nie da się odtworzyć `wrapKey`. Serwer (i ktoś, kto go przejmie bez podmiany kodu) nie może odszyfrować danych wrażliwych.
5. Minimalna długość hasła (12 znaków) i odrzucanie najsłabszych haseł sprawdza przeglądarka, bo serwer hasła nie widzi.
6. Do `authKey` dochodzi TOTP. Sekret TOTP zapisany na serwerze w postaci zaszyfrowanej kluczem z `APP_SECRET` (wyciek samej bazy go nie ujawnia).

### 5.2 Klucze
| Klucz | Co to | Gdzie leży |
|---|---|---|
| Klucz organizacji (`OrgKey`, AES-GCM 256) | szyfruje dane wrażliwe i klucze plików; ma numer wersji | nigdzie jawnie; tylko w slotach |
| Para kluczy użytkownika (RSA-OAEP 3072, SHA-256) | publiczny do nadawania dostępu, prywatny do odbierania | publiczny jawnie na serwerze; prywatny zaszyfrowany `wrapKey` na serwerze |
| Slot (`KeySlot`) | klucz organizacji zaszyfrowany kluczem publicznym użytkownika | serwer, jeden na użytkownika i wersję klucza |
| Klucz odzyskiwania | losowe 256 bitów pokazane raz w kreatorze, do wydruku | papier / sejf organizacji; na serwerze tylko slot odzyskiwania |
| `APP_SECRET` | sekret serwera: TOTP, sól pozorna, podpisy | zmienna środowiskowa |

### 5.3 Operacje
- **Kreator:** przeglądarka administratora losuje klucz organizacji, tworzy parę kluczy administratora, jego slot i slot odzyskiwania. Klucz odzyskiwania pokazany raz, z wymuszonym potwierdzeniem („wpisz 4 ostatnie znaki”).
- **Zaproszenie:** nowa osoba ustawia hasło i 2FA; przeglądarka tworzy jej parę kluczy. Bez dostępu do danych wrażliwych, dopóki go nie nada administrator.
- **Nadanie dostępu do danych wrażliwych:** przeglądarka administratora (ma klucz organizacji) szyfruje go kluczem publicznym tej osoby i wysyła slot. Serwer tylko przechowuje.
- **Odebranie dostępu:** usunięcie slotu i natychmiastowe zakończenie sesji tej osoby. Mogła wcześniej zapamiętać klucz, więc administrator dostaje propozycję **zmiany klucza organizacji** (nowa wersja dla nowych zapisów; przeszyfrowanie starych danych w przeglądarce administratora).
- **Zmiana hasła:** przeglądarka odszyfrowuje klucz prywatny starym `wrapKey` i szyfruje nowym. Klucz organizacji i dane bez zmian.
- **Zapomniane hasło:** administrator resetuje konto. Osoba ustawia nowe hasło i dostaje nową parę kluczy; stare sloty znikają, dostęp do danych wrażliwych trzeba nadać ponownie.
- **Utrata wszystkich dostępów:** ekran „Odzyskaj dostęp” z kluczem odzyskiwania tworzy nowy slot dla zalogowanego administratora.

### 5.4 Szyfrowanie danych
- **Pola wrażliwe osoby:** jeden JSON na osobę, AES-GCM kluczem organizacji, losowe IV (96 bitów), dane dodatkowe (AAD) = `contact_id` + wersja klucza. Szyfrogramu nie da się przenieść do innej osoby.
- **Załączniki:** każdy plik własnym losowym kluczem (AES-GCM), szyfrowany w przeglądarce przed wysłaniem. Klucz pliku, nazwa i typ w metadanych zaszyfrowanych kluczem organizacji. Serwer zna tylko rozmiar i to, kto i kiedy dodał plik. Limit wielkości na start 20 MB (limit żądania hostingu 120 s).
- **Po odświeżeniu strony** klucze znikają z pamięci (nie trafiają do `localStorage` ani `sessionStorage`). Zwykłe dane działają dalej na sesji, a dane wrażliwe pokazują „Odblokuj” (ponowne podanie hasła). Automatyczna blokada po bezczynności.

### 5.5 Ograniczenia (mówimy o nich wprost w dokumentacji)
- Kto przejmie serwer i **podmieni kod aplikacji**, może przechwycić hasło przy następnym logowaniu. Tego model nie broni (rozdział 3).
- Wyciek bazy przy słabym haśle pozwala na atak słownikowy offline. Chronią PBKDF2 + scrypt i wymagania co do hasła, ale nie w pełni.
- Wyszukiwanie, sortowanie i raporty po danych wrażliwych tylko w przeglądarce, po odblokowaniu.
- Tożsamość (imię, kontakt) w wersji 1 jest jawna dla serwera (wyszukiwanie, duplikaty). Szyfrowanie tożsamości: rozdział 7.

## 6. Anonimizacja jako zabezpieczenie (pomysł MOC do przetestowania)
Żywych danych w CRM nie da się trwale zanonimizować, bo z ludźmi trzeba się kontaktować. Anonimizacja ogranicza za to, ile i co może wyciec. Cztery formy:

1. **Pseudonimizacja całej bazy (najmocniejsza).** Tożsamość (imię, nazwisko, kontakt, PESEL) w jednym miejscu, osobno i zaszyfrowana. Reszta (działania, obecności, notatki, statystyki) zna tylko UUID osoby. Baza bez klucza do tożsamości pokazuje numery i statystyki, nie ludzi.
2. **Anonimizacja z upływem czasu.** Po zakończeniu projektu i okresie przechowywania dane osoby są usuwane, statystyka zostaje. W bazie zostają głównie bieżący uczestnicy, a czego nie ma, to nie wycieknie.
3. **Zanonimizowane kopie i eksporty.**
   - Raport dla grantodawcy bez danych identyfikujących.
   - **Kopia do pomocy technicznej:** organizacja wysyła MOC kopię z podmienionymi danymi. MOC diagnozuje błąd i nie staje się podmiotem przetwarzającym.
   - Baza demo i szkoleniowa.
4. **Widok bez danych dla wybranych ról,** np. ewaluator widzi „Uczestnik 17” zamiast nazwiska.

### Konsekwencje dla wersji chmurowej
- Anonimizacja fizycznie usuwa wiersze `contact_identity` i `contact_sensitive` oraz załączniki osoby, a w `contacts` zostawia znacznik `anonymizedAt`. `change_log` nie ma wartości tożsamości (zasada danych 8), więc nie trzeba go czyścić.
- Do rozstrzygnięcia: co z treścią wpisów na osi aktywności i notatek, które wymieniają osobę z nazwiska (propozycja: usunięcie treści wpisów powiązanych tylko z tą osobą, ostrzeżenie przy wpisach wspólnych).
- Lista usuniętych ID (`erased_contacts`, bez danych osobowych) nakładana automatycznie po odtworzeniu kopii.

### Plan testów (na prototypie desktopowym albo chmurowym, tylko dane fikcyjne)
1. **„Nic nie zostało”:** fikcyjna osoba z charakterystycznym nazwiskiem → anonimizacja → przeszukanie bazy, `change_log`, załączników i kopii. Zaliczony, gdy nazwisko nie występuje nigdzie.
2. **Kopia do pomocy:** zanonimizowana kopia bazy demo → przeszukanie pod kątem imion, nazwisk, PESEL-i, telefonów i e-maili z oryginału. Zaliczony, gdy nic nie znaleziono, a aplikacja działa na kopii normalnie.
3. **Pseudonimizacja:** zrzut bazy bez tabeli `contact_identity`. Zaliczony, gdy widać tylko UUID i statystyki.

## 7. Później
- Szyfrowanie po stronie przeglądarki także danych tożsamości (imię, kontakt). Model z rozdziału 5 na to pozwala, kosztem wyszukiwania i raportów po stronie przeglądarki.
- Klucze dostępu (passkeys) jako drugi składnik zamiast TOTP.
- Zewnętrzny test penetracyjny (jeśli będzie budżet).
- Wersja mobilna lub uproszczona dla wolontariuszy.

## 8. Prawo — do konsultacji z prawnikiem
- Rola MOC jako autora oprogramowania bez dostępu do danych (nie podmiot przetwarzający).
- **Cyber Resilience Act:** darmowe open source bez celu zarobkowego co do zasady poza zakresem. Jednorazowa opłata może oznaczać status producenta: aktualizacje bezpieczeństwa przez okres wsparcia, zgłaszanie aktywnie wykorzystywanych podatności (od 11.09.2026), pełne obowiązki od 11.12.2027. Wpływa na decyzję „za darmo czy jednorazowa opłata”.
- Licencja i wyłączenie odpowiedzialności („tak jak jest”).

## 9. Wnioski dla wersji desktopowej (z 2026-11-13, przed ZADANIEM_05 desktopu)
- Usunięcie oznaczeniem (`deletedAt`) i `change_log` z poprzednimi wartościami kłócą się z prawem do usunięcia. Potrzebna operacja anonimizacji, która czyści rekord, dziennik i pliki zmian (kompaktowanie folderu synchronizacji).
- Oddzielna tabela tożsamości i danych wrażliwych (wspólny model z wersją chmurową).
- Sloty kluczy (osobne hasło dla każdego użytkownika) zamiast jednego hasła organizacji. Przy odebraniu dostępu nowy klucz dla nowych plików zmian.
- Szyfrowany magazyn załączników zamiast zwykłego folderu.

## 10. Otwarte pytania
- Procedura przy utracie klucza danych wrażliwych (kto w organizacji trzyma klucz odzyskiwania).
- Za darmo czy jednorazowa opłata (po konsultacji CRA).
- Licencja open source.
- Treść osi aktywności przy anonimizacji (rozdział 6).
- RSA-OAEP czy ECDH (P-256) dla par kluczy użytkowników: RSA jest prostsze w WebCrypto (`wrapKey` wprost), ECDH ma krótsze klucze. Propozycja: RSA-OAEP.
