<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('schedules', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->foreignId('workflow_id')->constrained('workflows')->onDelete('cascade');
            // group_id nullable = todos los dispositivos online
            $table->unsignedBigInteger('group_id')->nullable()->index();
            $table->enum('mode', ['fixed_times', 'loop'])->default('loop');
            // fixed_times: array de "HH:MM"
            $table->json('times')->nullable();
            // loop: franja horaria y pausa entre vueltas
            $table->time('window_start')->nullable();
            $table->time('window_end')->nullable();
            $table->unsignedInteger('loop_gap_seconds')->default(0);
            // días de la semana 0-6 (0=domingo); null = todos
            $table->json('days_of_week')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_run_at')->nullable();
            $table->timestamp('next_run_at')->nullable();
            $table->timestamps();

            $table->index(['is_active', 'mode']);
        });
    }

    public function down(): void {
        Schema::dropIfExists('schedules');
    }
};
