<?php

namespace App\Console\Commands;

use App\Models\ApiKey;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class CreateApiToken extends Command {
    protected $signature = 'token:create {name : Nombre identificador del token (ej. dashboard, mcp-server, ws-server)}';
    protected $description = 'Genera un API token y guarda su hash en la tabla api_keys';

    public function handle(): int {
        $name = $this->argument('name');
        $token = Str::random(48);

        ApiKey::create([
            'name' => $name,
            'token_hash' => hash('sha256', $token),
        ]);

        $this->info("Token creado para '{$name}'. Guárdalo ahora, no se volverá a mostrar:");
        $this->line($token);

        return Command::SUCCESS;
    }
}
