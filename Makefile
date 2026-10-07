NAME = blur-my-shell
UUID = $(NAME)@eturkes.com
GETTEXT_DOMAIN = $(NAME)@aunetx
VM_PATH = ~/Projects/shared/extensions
GJS ?= /usr/bin/gjs
GNOME_EXTENSIONS ?= /usr/bin/gnome-extensions
GLIB_COMPILE_SCHEMAS ?= /usr/bin/glib-compile-schemas

.PHONY: build install check pot test-shell test-prefs test-vm remove clean

build: clean
	mkdir -p build/source
	cp -a src/. build/source/
	cp metadata.json LICENSE build/source/
	cp -a resources/icons resources/ui schemas build/source/
	$(GLIB_COMPILE_SCHEMAS) --strict build/source/schemas
	$(GJS) -m scripts/flatten-stylesheet.js src/stylesheet.css build/source/stylesheet.css
	cd build/source && $(GNOME_EXTENSIONS) pack -f . \
			--extra-source=LICENSE \
			--extra-source=icons \
			--extra-source=ui \
			--extra-source=components \
			--extra-source=conveniences \
			--extra-source=effects \
			--extra-source=preferences \
			--extra-source=dbus \
			--extra-source=styles \
			--podir=../../po \
			--gettext-domain=$(GETTEXT_DOMAIN) \
			--schema=../../schemas/org.gnome.shell.extensions.$(NAME).gschema.xml \
			-o ..
	# Keep the personal archive usable by direct extraction on this host too.
	cd build/source && zip -q ../$(UUID).shell-extension.zip schemas/gschemas.compiled

# Installs the private UUID only. Activation/session restart is deliberately manual.
install: build
	$(GNOME_EXTENSIONS) install -f build/$(UUID).shell-extension.zip

check: build
	./tests/run.sh --stylesheet build/source/stylesheet.css

pot:
	find resources/ui -iname "*.ui" -printf "%p\n" | sort | \
		xargs xgettext --output=po/$(GETTEXT_DOMAIN).pot src/effects/effects.js src/effects/effect_groups.js \
		--from-code=utf-8 --package-name=$(GETTEXT_DOMAIN)
	rm po/LINGUAS
	for l in $$(ls po/*.po); do \
		basename $$l .po >> po/LINGUAS; \
	done
	cd po && \
	for lang in $$(cat LINGUAS); do \
		mv $${lang}.po $${lang}.po.old; \
		msginit --no-translator --locale=$$lang --input $(GETTEXT_DOMAIN).pot -o $${lang}.po.new; \
		msgmerge -N $${lang}.po.old $${lang}.po.new > $${lang}.po; \
		rm $${lang}.po.old $${lang}.po.new; \
	done

test-shell: install
	env GNOME_SHELL_SLOWDOWN_FACTOR=2 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1500x1000 \
		MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 \
		dbus-run-session -- gnome-shell --devkit

test-prefs:
	$(GNOME_EXTENSIONS) prefs $(UUID)

test-vm: build
	unzip build/$(UUID).shell-extension.zip -d $(VM_PATH)/$(UUID)

remove:
	$(GNOME_EXTENSIONS) uninstall $(UUID)

clean:
	rm -rf build/ po/*.mo
