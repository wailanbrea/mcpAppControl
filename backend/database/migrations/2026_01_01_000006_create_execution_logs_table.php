<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('execution_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->nullable()->constrained('tasks')->onDelete('set null');
            $table->string('device_serial')->nullable();
            $table->string('command_type');
            $table->boolean('success');
            $table->text('message')->nullable();
            $table->json('result_data')->nullable();
            $table->timestamp('timestamp');
            $table->timestamps();

            $table->index(['device_serial', 'timestamp']);
            $table->index(['task_id', 'timestamp']);
        });
    }

    public function down(): void {
        Schema::dropIfExists('execution_logs');
    }
};
